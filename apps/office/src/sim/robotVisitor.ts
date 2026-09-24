import type * as THREE from 'three';
import type { Navigation } from '../nav/navigation';
import { RobotPuppet } from '../render/robot';
import { v2, type Vec2 } from '../util/math';
import { Rng } from '../util/rng';
import type { OfficeLayout } from '../world/layout';
import { Body } from './body';

/** Only when the office is this quiet… */
const QUIET_BELOW = 25;
/** …and then only now and then (seconds between tours). */
const MIN_GAP = 45;
const MAX_GAP = 120;

/**
 * The office robot lives at its charging dock in the east hallway. Every now
 * and then, when there's not much going on, it tours a few rooms (stopping to
 * look around and wave) and then walks back to charge. It never leaves the
 * building, so it never has to pass the lobby gates.
 */
export class RobotVisitor {
  private readonly rng = new Rng('robot');
  private readonly body: Body<RobotPuppet>;
  private readonly dock: Vec2;
  private cooldown = this.rng.float(15, 30);
  private stops: Vec2[] = [];
  private linger = 0;
  private touring = false;
  private readonly points: Vec2[];

  constructor(
    scene: THREE.Scene,
    nav: Navigation,
    private readonly layout: OfficeLayout,
    private readonly occupancy: () => number,
  ) {
    // Stops inside rooms: spots and seat approaches (all indoors, behind the gates).
    this.points = [...layout.rooms.values()]
      .filter((r) => r.def.kind !== 'lobby')
      .flatMap((r) => [...r.spots.map((s) => s.pos), ...r.seats.map((s) => s.approach)]);
    const d = layout.robotDock;
    this.dock = v2(d.x, d.z);
    const puppet = new RobotPuppet();
    scene.add(puppet.root);
    this.body = new Body(nav, puppet, this.dock, false);
    this.goHome();
    this.cooldown = this.rng.float(15, 30);
  }

  update(dt: number, time: number) {
    const b = this.body;
    const quiet = this.occupancy() <= QUIET_BELOW;
    if (!this.touring) {
      this.cooldown -= dt;
      if (quiet && this.cooldown <= 0) this.startTour();
    } else if (!quiet) {
      this.goHome();
    } else if (b.arrived) {
      if (this.linger <= 0) {
        this.linger = this.rng.float(3, 6);
        b.gesture = this.rng.chance(0.35) ? 'interact-right' : 'idle';
      }
      this.linger -= dt;
      if (this.linger <= 0) this.next();
    }
    b.update(dt, time, {});
  }

  private startTour() {
    this.touring = true;
    this.stops = Array.from({ length: this.rng.int(4, 6) }, () => this.rng.pick(this.points));
    this.next();
  }

  private next() {
    const b = this.body;
    b.gesture = null;
    this.linger = 0;
    const pos = this.stops.shift();
    if (!pos) return this.goHome();
    b.setGoal({ kind: 'point', pos: v2(pos.x, pos.z), key: `robot:${pos.x.toFixed(1)},${pos.z.toFixed(1)}` });
  }

  /** Walk back to the dock and charge (facing out into the hallway). */
  private goHome() {
    this.touring = false;
    this.stops = [];
    this.body.gesture = null;
    this.cooldown = this.rng.float(MIN_GAP, MAX_GAP);
    this.body.setGoal({ kind: 'point', pos: this.dock, yaw: this.layout.robotDock.yaw, key: 'robot:dock' });
  }
}
