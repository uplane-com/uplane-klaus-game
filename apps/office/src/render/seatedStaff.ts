import * as THREE from 'three';
import type { Character } from './characters';

/** Seat height/back offset for a desk chair (matches Body's SEAT_Y / SEAT_BACK). */
const SEAT_Y = 0.52;
const SEAT_BACK = 0.08;

/** How long a greeting (look + wave + wink bubble) lasts. */
const GREET_TIME = 1.8;
/** A receptionist greets at most this often (s). */
const GREET_GAP = 2.5;

let winkTexture: THREE.Texture | null = null;
/** 😉 in a white speech bubble. */
function winkBubble(): THREE.Sprite {
  if (!winkTexture) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(64, 58, 48, 0, Math.PI * 2);
    ctx.moveTo(52, 100);
    ctx.lineTo(64, 122);
    ctx.lineTo(76, 100);
    ctx.fill();
    ctx.font = '60px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('😉', 64, 62);
    winkTexture = new THREE.CanvasTexture(c);
    winkTexture.colorSpace = THREE.SRGBColorSpace;
  }
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: winkTexture, transparent: true, opacity: 0, depthTest: false }));
  sprite.scale.set(0.7, 0.7, 1);
  sprite.position.set(0, 2.0, 0);
  sprite.renderOrder = 10;
  return sprite;
}

interface Staffer {
  c: Character;
  yaw: number;
  phase: number;
  wave: number;
  /** Greeting in progress: seconds left and whom to look at. */
  greet: number;
  lookYaw: number;
  lastGreet: number;
  bubble: THREE.Sprite;
}

/**
 * Staff who are always at their desk (not agents): the receptionists at the
 * front desk and the operator in the server room. They type, glance around,
 * wave now and then and greet people coming in with a wink.
 */
export class SeatedStaff {
  private readonly staff: Staffer[] = [];
  private time = 0;

  constructor(scene: THREE.Scene, make: (index: number) => Character, seats: { x: number; z: number; yaw: number }[]) {
    seats.forEach((s, i) => {
      const c = make(i);
      c.root.position.set(s.x - Math.sin(s.yaw) * SEAT_BACK, SEAT_Y, s.z - Math.cos(s.yaw) * SEAT_BACK);
      c.root.rotation.y = s.yaw;
      c.play('sit', 0);
      c.setOpacity(1);
      scene.add(c.root);
      const bubble = winkBubble();
      c.root.add(bubble);
      this.staff.push({ c, yaw: s.yaw, phase: i * 3.1, wave: 0, greet: 0, lookYaw: s.yaw, lastGreet: -99, bubble });
    });
  }

  /** Someone came in at (x, z): the free staffer closest to them looks over, waves and winks. */
  greet(x: number, z: number) {
    const free = this.staff.filter((s) => s.greet <= 0 && this.time - s.lastGreet > GREET_GAP);
    if (!free.length) return;
    const dist = (s: Staffer) => Math.hypot(s.c.root.position.x - x, s.c.root.position.z - z);
    const s = free.reduce((a, b) => (dist(b) < dist(a) ? b : a));
    const dx = x - s.c.root.position.x;
    const dz = z - s.c.root.position.z;
    // Turn towards the visitor, but stay roughly facing the desk.
    let rel = Math.atan2(dx, dz) - s.yaw;
    rel = Math.atan2(Math.sin(rel), Math.cos(rel));
    s.lookYaw = s.yaw + Math.max(-1.1, Math.min(1.1, rel));
    s.greet = GREET_TIME;
    s.lastGreet = this.time;
  }

  update(dt: number, time: number, incident: boolean) {
    this.time = time;
    for (const s of this.staff) {
      const t = time + s.phase;
      const greeting = s.greet > 0 && !incident;
      s.greet = Math.max(0, s.greet - dt);
      // Alternate between typing and glancing at the entrance / colleague.
      const typing = !incident && !greeting && Math.sin(t * 0.21) > -0.2;
      const target = greeting ? s.lookYaw : s.yaw + (typing ? 0 : Math.sin(t * 0.5) * 0.5);
      s.c.root.rotation.y += (target - s.c.root.rotation.y) * (1 - Math.exp(-(greeting ? 8 : 3) * dt));
      if (s.wave <= 0 && !typing && !greeting && Math.sin(t * 0.13) > 0.97) s.wave = 1.6;
      s.wave = Math.max(0, s.wave - dt);
      // Wink bubble pops in and fades out over the greeting.
      const k = greeting ? Math.min(1, (GREET_TIME - s.greet) * 6, s.greet * 3) : 0;
      const m = s.bubble.material;
      m.opacity = k;
      s.bubble.visible = k > 0.01;
      s.bubble.scale.setScalar(0.85 + 0.2 * k);
      s.c.update(dt, { seated: true, typing, handUp: s.wave > 0 || greeting, thinking: incident }, time);
    }
  }
}
