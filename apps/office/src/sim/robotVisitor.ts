import type * as THREE from 'three';
import type { Navigation } from '../nav/navigation';
import { RobotPuppet } from '../render/robot';
import { v2, type Vec2 } from '../util/math';
import { Rng } from '../util/rng';
import type { OfficeLayout } from '../world/layout';
import { Body } from './body';

/** Only when the office is this quiet… */
const QUIET_BELOW = 25;
/** …and then only now and then (seconds between visits). */
const MIN_GAP = 45;
const MAX_GAP = 120;

/**
 * Every now and then, when there's not much going on, a humanoid robot walks in
 * through the entrance, tours a few rooms (stopping to look around and wave)
 * and leaves again.
 */
export class RobotVisitor {
  private readonly rng = new Rng('robot');
  private body: Body<RobotPuppet> | null = null;
  private cooldown = this.rng.float(15, 30);
  private stops: Vec2[] = [];
  private linger = 0;
  private leaving = false;
  private readonly points: Vec2[];

  constructor(
    private readonly scene: THREE.Scene,
    private readonly nav: Navigation,
    private readonly layout: OfficeLayout,
    private readonly occupancy: () => number,
  ) {
    // Somewhere in the middle of every room with free floor: spots and seat approaches.
    this.points = [...layout.rooms.values()].flatMap((r) => [...r.spots.map((s) => s.pos), ...r.seats.map((s) => s.approach)]);
  }

  get active() {
    return this.body !== null;
  }

  update(dt: number, time: number) {
    const quiet = this.occupancy() <= QUIET_BELOW;
    if (!this.body) {
      this.cooldown -= dt;
      if (quiet && this.cooldown <= 0) this.spawn();
      return;
    }
    const b = this.body;
    if (!quiet) this.leave();
    if (!this.leaving && b.arrived) {
      if (this.linger <= 0) {
        this.linger = this.rng.float(3, 6);
        b.gesture = this.rng.chance(0.35) ? 'interact-right' : 'idle';
      }
      this.linger -= dt;
      if (this.linger <= 0) this.next();
    }
    b.update(dt, time, {});
    if (b.gone) {
      b.dispose();
      this.body = null;
      this.cooldown = this.rng.float(MIN_GAP, MAX_GAP);
    }
  }

  private spawn() {
    const puppet = new RobotPuppet();
    this.scene.add(puppet.root);
    this.body = new Body(this.nav, puppet, this.layout.entrance.outside);
    this.leaving = false;
    this.stops = Array.from({ length: this.rng.int(4, 6) }, () => this.rng.pick(this.points));
    this.next();
  }

  private next() {
    const b = this.body!;
    b.gesture = null;
    this.linger = 0;
    const pos = this.stops.shift();
    if (!pos) return this.leave();
    b.setGoal({ kind: 'point', pos: v2(pos.x, pos.z), key: `robot:${pos.x.toFixed(1)},${pos.z.toFixed(1)}` });
  }

  private leave() {
    if (this.leaving || !this.body) return;
    this.leaving = true;
    this.body.gesture = null;
    this.body.setGoal({ kind: 'exit', pos: this.layout.entrance.outside });
  }
}
