import * as THREE from 'three';
import type { Navigation } from '../nav/navigation';
import type { CharacterLibrary } from '../render/characters';
import { v2, type Vec2 } from '../util/math';
import { Rng } from '../util/rng';
import type { OfficeLayout } from '../world/layout';
import { Body } from './body';

/** Staff come in when at most this many agents are in the building… */
const QUIET_BELOW = 25;
/** …and leave again once it gets this busy. */
const BUSY_ABOVE = 45;
/** How long the office has to stay quiet/busy before staff react (s). */
const SETTLE = 6;

type Kind = 'janitor' | 'cleaner';

interface Worker {
  kind: Kind;
  body: Body;
  /** Pivot for the mop (cleaner) or the cart (janitor). */
  tool: THREE.Group;
  /** Seconds left working at the current stop. */
  work: number;
  leaving: boolean;
  /** Remaining stops in the current room (cleaner) before picking another room. */
  queue: Vec2[];
  /** 0..1 blend of the work pose (eases in/out instead of snapping). */
  workBlend: number;
  /** Stroke phase (radians). */
  phase: number;
}

/**
 * Facility staff for quiet hours: a janitor pushing a cleaning cart along the
 * hallways and common areas, and a cleaner mopping room by room. They come in
 * through the service exit when the office empties out and leave when it fills up.
 */
export class Housekeeping {
  private readonly workers: Worker[] = [];
  private readonly rng = new Rng('housekeeping');
  private quietFor = 0;
  private busyFor = 0;
  private readonly hallStops: Vec2[];
  private readonly commonStops: Vec2[];
  private readonly rooms: Vec2[][];

  constructor(
    private readonly scene: THREE.Scene,
    private readonly lib: CharacterLibrary,
    private readonly nav: Navigation,
    private readonly layout: OfficeLayout,
    private readonly occupancy: () => number,
  ) {
    const rooms = [...layout.rooms.values()];
    // Hallway stops: just outside every room door.
    this.hallStops = rooms.flatMap((r) =>
      r.doors.map((d) => {
        const out = { n: v2(0, -1.6), s: v2(0, 1.6), w: v2(-1.6, 0), e: v2(1.6, 0) }[d.side];
        return v2(d.x + out.x, d.z + out.z);
      }),
    );
    this.commonStops = rooms
      .filter((r) => r.def.kind === 'lounge' || r.def.kind === 'lobby' || r.def.kind === 'meeting')
      .flatMap((r) => [...r.seats.map((s) => s.approach), ...r.spots.map((s) => s.pos)]);
    // Cleaning stops per room: walkable points next to seats and spots.
    this.rooms = rooms
      .filter((r) => r.def.kind !== 'server')
      .map((r) => [...r.seats.map((s) => s.approach), ...r.spots.map((s) => s.pos)])
      .filter((stops) => stops.length > 0);
  }

  get active() {
    return this.workers.length;
  }

  update(dt: number, time: number) {
    const n = this.occupancy();
    this.quietFor = n <= QUIET_BELOW ? this.quietFor + dt : 0;
    this.busyFor = n >= BUSY_ABOVE ? this.busyFor + dt : 0;
    if (this.quietFor > SETTLE && !this.workers.length) {
      this.spawn('janitor');
      this.spawn('cleaner');
    }
    if (this.busyFor > SETTLE) for (const w of this.workers) this.leave(w);

    for (let i = this.workers.length - 1; i >= 0; i--) {
      const w = this.workers[i];
      this.step(w, dt, time);
      if (w.body.gone) {
        w.body.dispose();
        this.workers.splice(i, 1);
      }
    }
  }

  private spawn(kind: Kind) {
    const char =
      kind === 'janitor'
        ? this.lib.createStaff('staff-janitor', 'character-male-e', 3.6, [0.3, 0.38, 0.55])
        : this.lib.createStaff('staff-cleaner', 'character-female-b', 1.1, [0.42, 0.42, 0.5]);
    const tool = kind === 'janitor' ? buildCart() : buildMop();
    char.root.add(tool);
    this.scene.add(char.root);
    const door = this.layout.serviceDoor;
    const body = new Body(this.nav, char, v2(door.x, door.z + (kind === 'janitor' ? -1 : 1)));
    const w: Worker = { kind, body, tool, work: 0, leaving: false, queue: [], workBlend: 0, phase: 0 };
    this.workers.push(w);
    this.next(w);
  }

  private leave(w: Worker) {
    if (w.leaving) return;
    w.leaving = true;
    w.work = 0;
    w.body.gesture = null;
    w.body.setGoal({ kind: 'exit', pos: this.layout.serviceDoor });
  }

  /** Pick the next stop. */
  private next(w: Worker) {
    let pos: Vec2;
    if (w.kind === 'janitor') {
      pos = this.rng.chance(0.6) ? this.rng.pick(this.hallStops) : this.rng.pick(this.commonStops);
    } else {
      if (!w.queue.length) {
        const room = this.rng.pick(this.rooms);
        w.queue = Array.from({ length: Math.min(3, room.length) }, () => this.rng.pick(room));
      }
      pos = w.queue.shift()!;
    }
    w.body.gesture = null;
    w.body.setGoal({ kind: 'point', pos, key: `${w.kind}:${pos.x.toFixed(1)},${pos.z.toFixed(1)}` });
  }

  private step(w: Worker, dt: number, time: number) {
    const b = w.body;
    if (!w.leaving && b.arrived) {
      if (w.work <= 0) w.work = w.kind === 'janitor' ? this.rng.float(4, 7) : this.rng.float(6, 10);
      w.work -= dt;
      if (w.work <= 0) this.next(w);
    }
    const working = !w.leaving && b.arrived && w.work > 0;
    // Ease the work pose in and out (~0.4 s) and advance a slow, even stroke.
    w.workBlend += ((working ? 1 : 0) - w.workBlend) * Math.min(1, dt * 5);
    w.phase += dt * (w.kind === 'cleaner' ? 2.3 : 1.6);
    const swing = Math.sin(w.phase);
    // Procedural poses replace the generic interact clip; the idle clip keeps the legs natural.
    b.gesture = working ? 'idle' : null;
    if (w.kind === 'cleaner') {
      // Mop head sweeps in the same rhythm as the arms, carried upright while walking.
      w.tool.rotation.y = swing * 0.45 * w.workBlend;
      const tilt = w.tool.getObjectByName('tilt')!;
      tilt.rotation.x = -0.35 - 0.27 * w.workBlend;
    }
    const pose =
      w.kind === 'cleaner'
        ? { sweep: { weight: w.workBlend, swing } }
        : { ride: w.workBlend < 0.5, wipe: { weight: w.workBlend, swing } };
    b.update(dt, time, pose);
  }
}

const mat = (color: string, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.7, ...extra });

function part(parent: THREE.Object3D, geo: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  parent.add(m);
  return m;
}

const MOP_LENGTH = 0.95;

/**
 * Mop held with both hands in front (slightly right). The outer group swings it side to
 * side (yaw), the inner `tilt` group leans it forward; the stick hangs from
 * the hand so the head always stays attached at the bottom.
 */
function buildMop(): THREE.Group {
  const swing = new THREE.Group();
  swing.position.set(-0.12, 0.82, 0.36);
  const tilt = new THREE.Group();
  tilt.name = 'tilt';
  swing.add(tilt);
  part(tilt, new THREE.CylinderGeometry(0.022, 0.022, MOP_LENGTH, 6), mat('#9aa3b2', { metalness: 0.5 }), 0, -MOP_LENGTH / 2, 0);
  part(tilt, new THREE.BoxGeometry(0.46, 0.05, 0.16), mat('#3aa0ff'), 0, -MOP_LENGTH, 0);
  return swing;
}

/** Cleaning cart pushed in front of the janitor. */
function buildCart(): THREE.Group {
  const g = new THREE.Group();
  g.position.set(0, 0, 0.95);
  part(g, new THREE.BoxGeometry(0.75, 0.5, 0.95), mat('#2f6fd6'), 0, 0.45, 0.15);
  part(g, new THREE.BoxGeometry(0.8, 0.04, 1.0), mat('#d9dde3'), 0, 0.72, 0.15);
  part(g, new THREE.CylinderGeometry(0.19, 0.16, 0.34, 10), mat('#ffc83d'), -0.18, 0.9, 0.35);
  part(g, new THREE.SphereGeometry(0.22, 8, 6), mat('#1b1d22', { roughness: 0.4 }), 0.2, 0.92, 0.0);
  part(g, new THREE.BoxGeometry(0.12, 0.26, 0.12), mat('#3ecf8e'), 0.22, 0.87, 0.42);
  // Handle towards the janitor.
  part(g, new THREE.CylinderGeometry(0.025, 0.025, 0.8, 6), mat('#9aa3b2', { metalness: 0.5 }), 0, 0.95, -0.35).rotation.z = Math.PI / 2;
  for (const x of [-0.35, 0.35]) part(g, new THREE.BoxGeometry(0.03, 0.5, 0.03), mat('#9aa3b2', { metalness: 0.5 }), x, 0.72, -0.35);
  const wheel = new THREE.CylinderGeometry(0.08, 0.08, 0.05, 10).rotateZ(Math.PI / 2);
  for (const [x, z] of [[-0.33, -0.25], [0.33, -0.25], [-0.33, 0.55], [0.33, 0.55]]) part(g, wheel, mat('#22252b'), x, 0.08, z);
  return g;
}
