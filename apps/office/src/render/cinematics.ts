import * as THREE from 'three';
import type { Stage } from './stage';

/**
 * TV mode: an automatic camera that tours the office with slow, smooth moves.
 * Any manual camera interaction pauses it; it resumes after a while.
 * During an incident it cuts to the server room and stays there.
 */

interface Shot {
  name: string;
  target: THREE.Vector3;
  /** Horizontal viewing angle offset from the default iso angle. */
  yaw: number;
  pitch: number;
  zoom: number;
  duration: number;
  /** Slow orbit speed while holding the shot (rad/s). */
  orbit: number;
  /** Only show this shot when enough agents are inside this rect [x0, z0, x1, z1]. */
  area?: [number, number, number, number];
  /** Follow shot: pick someone to track for the duration of the shot. */
  pick?: () => Tracker | null;
  follow?: Tracker;
}

/** Returns the tracked position, or null once the subject is gone. */
export type Tracker = () => THREE.Vector3 | null;

const BASE_YAW = Math.atan2(-55, 95);
const BASE_PITCH = 0.72;
const DIST = 140;
const RESUME_AFTER = 25;

const v = (x: number, z: number) => new THREE.Vector3(x, 0, z);

export class Cinematics {
  enabled = true;
  private shots: Shot[];
  private shotTime = 0;
  private current: Shot;
  private yaw = BASE_YAW;
  private pitch = BASE_PITCH;
  private readonly target = new THREE.Vector3();
  private orbitAngle = 0;
  private pausedFor = 0;
  private incidentShot = 0;
  private incidentTimer = 0;
  private wasIncident = false;

  private readonly overview: Shot = { name: 'overview', target: v(35, 40), yaw: 0, pitch: 0, zoom: 0.78, duration: 16, orbit: 0.01 };
  private readonly closeUp: Shot;
  private lastArea = '';
  private shotCount = 0;

  constructor(
    private readonly stage: Stage,
    pickWalker: () => Tracker | null,
    /** Number of agents inside a rect, used to skip empty areas. */
    private readonly countIn: (x0: number, z0: number, x1: number, z1: number) => number,
  ) {
    // Area shots: moderately zoomed, only chosen when people are there.
    this.shots = [
      { name: 'ad studio', target: v(33, 10), yaw: 0.2, pitch: -0.03, zoom: 1.6, duration: 13, orbit: -0.015, area: [0, 0, 66, 18] },
      { name: 'engineering', target: v(40, 33), yaw: -0.15, pitch: 0, zoom: 1.55, duration: 13, orbit: 0.015, area: [0, 24, 80, 42] },
      { name: 'arrivals', target: v(33, 70), yaw: 0.12, pitch: -0.05, zoom: 1.7, duration: 12, orbit: 0.012, area: [-40, 60, 110, 84] },
      { name: 'comms + lobby', target: v(22, 56), yaw: 0.1, pitch: -0.03, zoom: 1.75, duration: 11, orbit: -0.015, area: [0, 48, 44, 64] },
      { name: 'lounge', target: v(62, 56), yaw: -0.25, pitch: -0.03, zoom: 1.85, duration: 11, orbit: 0.02, area: [44, 48, 96, 64] },
      { name: 'library + meetings', target: v(81, 10), yaw: 0.25, pitch: 0, zoom: 1.8, duration: 11, orbit: -0.015, area: [66, 0, 96, 18] },
      { name: 'creative studio', target: v(-19, 21), yaw: 0.2, pitch: -0.03, zoom: 1.6, duration: 13, orbit: 0.015, area: [-32, 0, -6, 42] },
      { name: 'tv + podcast', target: v(-19, 56), yaw: 0.2, pitch: -0.03, zoom: 1.9, duration: 10, orbit: -0.015, area: [-32, 48, -6, 64] },
      { name: 'server room', target: v(88, 33), yaw: -0.12, pitch: 0, zoom: 2.0, duration: 10, orbit: 0.02, area: [80, 24, 96, 42] },
    ];
    // Occasional close-up following someone walking around.
    this.closeUp = { name: 'agent', target: v(35, 38), yaw: 0.1, pitch: -0.08, zoom: 2.8, duration: 9, orbit: 0.025, pick: pickWalker };
    this.current = this.overview;
    this.target.copy(stage.controls.target);

    // Manual interaction pauses the tour.
    stage.controls.addEventListener('start', () => {
      this.pausedFor = RESUME_AFTER;
    });
  }

  /** Start the tour over from the overview shot (used when TV mode is switched on). */
  restart() {
    this.pausedFor = 0;
    this.shotCount = -1;
    this.shotTime = 0;
    this.orbitAngle = 0;
    this.wasIncident = false;
    this.syncFromCamera();
  }

  get shotName() {
    return this.current.name;
  }

  private next(): void {
    this.shotCount++;
    let shot: Shot = this.overview;
    // Every third shot is the wide overview; otherwise a busy area, rarely a close-up.
    if (this.shotCount % 3 !== 0) {
      const busy = this.shots
        .filter((sh) => sh.name !== this.lastArea)
        .map((sh) => ({ sh, n: this.countIn(...sh.area!) }))
        .filter((c) => c.n >= 4);
      if (Math.random() < 0.2 && this.closeUp.pick?.()) shot = this.closeUp;
      else if (busy.length) {
        // Weighted by how many agents are there.
        let r = Math.random() * busy.reduce((t, c) => t + c.n, 0);
        shot = busy.find((c) => (r -= c.n) <= 0)?.sh ?? busy[0].sh;
      }
    }
    this.lastArea = shot.name;
    const follow = shot.pick?.() ?? undefined;
    this.current = { ...shot, follow, target: follow?.()?.clone() ?? shot.target.clone() };
    this.shotTime = 0;
    this.orbitAngle = 0;
  }

  update(dt: number, incident: boolean) {
    if (!this.enabled) return;
    if (this.pausedFor > 0) {
      this.pausedFor -= dt;
      if (this.pausedFor <= 0) this.syncFromCamera();
      return;
    }

    if (incident) {
      // Alternate between the whole server room and the ops desk.
      this.incidentTimer -= dt;
      if (!this.wasIncident || this.incidentTimer <= 0) {
        this.incidentShot = this.wasIncident ? 1 - this.incidentShot : 0;
        this.incidentTimer = 9;
        this.current =
          this.incidentShot === 0
            ? { name: 'incident', target: v(86, 33), yaw: -0.25, pitch: -0.02, zoom: 2.1, duration: 9, orbit: 0.04 }
            : { name: 'incident', target: v(88, 33), yaw: 0.3, pitch: -0.06, zoom: 2.9, duration: 9, orbit: -0.04 };
        this.orbitAngle = 0;
      }
    } else {
      if (this.wasIncident) this.shotTime = Infinity;
      this.shotTime += dt;
      if (this.shotTime > this.current.duration) this.next();
    }
    this.wasIncident = incident;

    const shot = this.current;
    if (shot.follow) {
      const p = shot.follow();
      if (p) shot.target.lerp(p, 1 - Math.exp(-1.5 * dt));
    }
    this.orbitAngle += shot.orbit * dt;

    // Ease every parameter towards the shot: slow, TV-friendly moves.
    const k = 1 - Math.exp(-0.7 * dt);
    this.target.lerp(shot.target, k);
    this.yaw += (BASE_YAW + shot.yaw + this.orbitAngle - this.yaw) * k;
    this.pitch += (BASE_PITCH + shot.pitch - this.pitch) * k;
    const cam = this.stage.camera;
    cam.zoom += (shot.zoom - cam.zoom) * k;
    cam.updateProjectionMatrix();

    const off = new THREE.Vector3(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch)).multiplyScalar(DIST);
    this.stage.controls.target.copy(this.target);
    cam.position.copy(this.target).add(off);
  }

  /** Continue from wherever the user left the camera. */
  private syncFromCamera() {
    const t = this.stage.controls.target;
    const d = this.stage.camera.position.clone().sub(t);
    this.target.copy(t);
    this.yaw = Math.atan2(d.x, d.z);
    this.pitch = Math.asin(d.y / d.length());
    this.shotTime = Infinity;
  }
}
