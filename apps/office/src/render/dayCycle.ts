import * as THREE from 'three';
import type { OfficeView } from './office';
import type { Stage } from './stage';

/** San Francisco. */
const LAT = 37.7749;
const LON = -122.4194;
const TIME_ZONE = 'America/Los_Angeles';
const RAD = Math.PI / 180;

/**
 * Sun position (NOAA-style approximation, good to a fraction of a degree).
 * Returns elevation above the horizon and azimuth clockwise from north, in radians.
 */
export function sunPosition(date: Date, lat = LAT, lon = LON) {
  const d = date.getTime() / 86_400_000 - 10_957.5; // days since J2000.0
  const g = (357.529 + 0.98560028 * d) * RAD;
  const q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
  const e = (23.439 - 0.00000036 * d) * RAD;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmst = (((18.697374558 + 24.06570982441908 * d) % 24) + 24) % 24;
  const H = (gmst * 15 + lon) * RAD - ra;
  const phi = lat * RAD;
  const el = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  const az = Math.atan2(-Math.sin(H), Math.tan(dec) * Math.cos(phi) - Math.sin(phi) * Math.cos(H));
  return { el, az };
}

/** Lighting keyframes by sun elevation (degrees). */
interface Look {
  el: number;
  sky: string;
  sun: string;
  sunI: number;
  hemiSky: string;
  hemiGround: string;
  hemiI: number;
  env: number;
  /** 0 = day … 1 = night (outdoor dimming, lamp pools). */
  night: number;
}

const LOOKS: Look[] = [
  { el: -12, sky: '#0b1224', sun: '#8fa8ff', sunI: 0.35, hemiSky: '#ffe9cc', hemiGround: '#2a3048', hemiI: 1.0, env: 0.08, night: 1 },
  { el: -4, sky: '#2d3563', sun: '#9aa8ff', sunI: 0.45, hemiSky: '#ffe3c4', hemiGround: '#3b3f5c', hemiI: 1.02, env: 0.1, night: 0.75 },
  { el: 2, sky: '#e59a7a', sun: '#ff9a55', sunI: 1.3, hemiSky: '#ffe0c0', hemiGround: '#6b5f63', hemiI: 1.08, env: 0.14, night: 0.3 },
  { el: 10, sky: '#f3cf9f', sun: '#ffc27a', sunI: 1.9, hemiSky: '#fff1e0', hemiGround: '#857f6e', hemiI: 1.15, env: 0.18, night: 0.05 },
  { el: 25, sky: '#bcd3e6', sun: '#fff4e0', sunI: 2.3, hemiSky: '#f4f7ff', hemiGround: '#8a8f7a', hemiI: 1.2, env: 0.22, night: 0 },
];

const ca = new THREE.Color();
const cb = new THREE.Color();
function lerpColor(out: THREE.Color, a: string, b: string, t: number) {
  return out.copy(ca.set(a)).lerp(cb.set(b), t);
}

/**
 * Day/night cycle driven by the real sun over San Francisco. Moves the sun
 * light across the sky, blends sky/light colours through golden hour and
 * dusk to night (office lights stay on, the outside goes dark and the street
 * lamps light the pavement), and exposes an SF clock label for the HUD.
 * `?time=21:30` (SF local) freezes the clock for previews.
 */
export class DayCycle {
  private offsetMs: number | null = null;
  private readonly center: THREE.Vector3;
  private readonly sunColor = new THREE.Color();
  private readonly skyColor = new THREE.Color();
  private readonly fmt = new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, hour: 'numeric', minute: '2-digit' });
  label = '';
  isNight = false;
  /** Called with the new base sun/ambient intensities (the alarm dims relative to them). */
  onLevels: ((sun: number, hemi: number) => void) | null = null;

  constructor(
    private readonly stage: Stage,
    private readonly office: OfficeView,
    override: string | null = null,
  ) {
    this.center = stage.sun.target.position.clone();
    if (override) this.setTime(override);
    this.apply();
  }

  /** Freeze the clock at an SF wall-clock time ("21:30"), or null to follow real time. */
  setTime(hhmm: string | null) {
    if (!hhmm) {
      this.offsetMs = null;
      return;
    }
    const [h, m] = hhmm.split(':').map(Number);
    const now = new Date();
    const sf = sfParts(now);
    // UTC instant of that SF wall-clock time today.
    const sfNowAsUtc = Date.UTC(sf.y, sf.mo - 1, sf.d, sf.h, sf.mi);
    const tzOffset = sfNowAsUtc - Math.floor(now.getTime() / 60_000) * 60_000;
    const target = Date.UTC(sf.y, sf.mo - 1, sf.d, h, m || 0) - tzOffset;
    this.offsetMs = target - now.getTime();
  }

  private now() {
    return new Date(Date.now() + (this.offsetMs ?? 0));
  }

  /** Recompute lighting (cheap; call a few times per minute). */
  apply() {
    const date = this.now();
    const { el, az } = sunPosition(date);
    const deg = el / RAD;
    const look = blend(deg);

    // Light direction: real azimuth; keep it reasonably high so shadows stay readable.
    const lightEl = deg > 0 ? Math.max(el, 14 * RAD) : 50 * RAD;
    const lightAz = deg > 0 ? az : az + Math.PI; // the "moon" roughly opposite the sun
    const dir = new THREE.Vector3(Math.sin(lightAz) * Math.cos(lightEl), Math.sin(lightEl), -Math.cos(lightAz) * Math.cos(lightEl));
    const s = this.stage;
    s.sun.position.copy(this.center).addScaledVector(dir, 150);
    s.sun.target.position.copy(this.center);
    s.sun.color.copy(this.sunColor.set(look.sun));
    s.sun.intensity = look.sunI;
    s.hemi.color.set(look.hemiSky);
    s.hemi.groundColor.set(look.hemiGround);
    s.hemi.intensity = look.hemiI;
    s.scene.environmentIntensity = look.env;
    this.skyColor.set(look.sky);
    (s.scene.background as THREE.Color).copy(this.skyColor);
    s.scene.fog?.color.copy(this.skyColor);
    this.office.setNight(look.night);
    this.onLevels?.(look.sunI, look.hemiI);

    this.isNight = look.night > 0.5;
    this.label = `${this.isNight ? '🌙' : deg < 10 ? '🌅' : '☀️'} ${this.fmt.format(date)} SF`;
  }
}

function blend(deg: number) {
  if (deg <= LOOKS[0].el) return LOOKS[0];
  if (deg >= LOOKS[LOOKS.length - 1].el) return LOOKS[LOOKS.length - 1];
  const i = LOOKS.findIndex((l) => l.el > deg);
  const a = LOOKS[i - 1];
  const b = LOOKS[i];
  const t = (deg - a.el) / (b.el - a.el);
  const lerp = (x: number, y: number) => x + (y - x) * t;
  const c = new THREE.Color();
  return {
    el: deg,
    sky: `#${lerpColor(c, a.sky, b.sky, t).getHexString()}`,
    sun: `#${lerpColor(c, a.sun, b.sun, t).getHexString()}`,
    sunI: lerp(a.sunI, b.sunI),
    hemiSky: `#${lerpColor(c, a.hemiSky, b.hemiSky, t).getHexString()}`,
    hemiGround: `#${lerpColor(c, a.hemiGround, b.hemiGround, t).getHexString()}`,
    hemiI: lerp(a.hemiI, b.hemiI),
    env: lerp(a.env, b.env),
    night: lerp(a.night, b.night),
  } satisfies Look;
}

function sfParts(date: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { y: get('year'), mo: get('month'), d: get('day'), h: get('hour'), mi: get('minute') };
}
