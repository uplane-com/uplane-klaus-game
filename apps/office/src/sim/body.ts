import type { CrowdAgent } from 'recast-navigation';
import type { Navigation } from '../nav/navigation';
import type { AnimName, Character, Pose } from '../render/characters';
import { damp, dampAngle, dist2, v2, yawTowards, type Vec2 } from '../util/math';
import type { Seat, SeatKind, Spot } from '../world/layout';

/**
 * The physical side of an agent: moves through the crowd, sits down on
 * seats, stands at spots and fades in/out. Decisions about *where* to go
 * come from the Director.
 */

export type Goal =
  | { kind: 'seat'; seat: Seat }
  | { kind: 'spot'; spot: Spot }
  | { kind: 'point'; pos: Vec2; yaw?: number; key: string }
  | { kind: 'exit'; pos: Vec2 };

/** What a Body needs from its visual: Kenney characters, but also e.g. the robot. */
export type Puppet = Pick<Character, 'root' | 'play' | 'setWalkSpeed' | 'update' | 'setOpacity' | 'walkFactor' | 'dispose'>;

export type Phase = 'walking' | 'sitting' | 'seated' | 'standingUp' | 'standing' | 'fading' | 'gone';

/**
 * Vertical offset while seated per seat type. The Kenney sit clip is a
 * floor-sitting pose (hips at ~0), so we lift the whole body to seat height.
 */
const SEAT_Y: Record<SeatKind, number> = { desk: 0.52, meeting: 0.52, sofa: 0.4, chair: 0.46, lap: 0.4 };
/** Pull the seated agent slightly back from the chair centre toward the backrest. */
const SEAT_BACK: Record<SeatKind, number> = { desk: 0.08, meeting: 0.08, sofa: 0.1, chair: 0.0, lap: 0.1 };

const BASE_SPEED = 2.4;
const ARRIVE_DIST = 0.3;

export class Body<C extends Puppet = Character> {
  x: number;
  z: number;
  y = 0;
  yaw: number;
  phase: Phase = 'walking';
  goal: Goal | null = null;
  opacity = 0;
  /** Seconds since the current goal was set. */
  goalAge = 0;
  /** Extra animation/pose requested by the Director while idle at a goal. */
  gesture: AnimName | null = null;

  private agent: CrowdAgent | null = null;
  private trans: { from: Vec2; to: Vec2; fromY: number; toY: number; fromYaw: number; toYaw: number; t: number; dur: number } | null = null;
  private pendingGoal: Goal | null = null;
  private stuckTimer = 0;
  private lastDist = Infinity;
  /** Closest distance to the goal so far and how long we've been failing to beat it (not reset by re-paths). */
  private bestDist = Infinity;
  private noProgress = 0;
  private squeezed = false;
  private pauseTimer = 0;
  private pauseYaw = 0;
  private speed: number;
  private hurried = false;

  constructor(
    private readonly nav: Navigation,
    readonly char: C,
    start: Vec2,
    fadeIn = true,
  ) {
    this.speed = BASE_SPEED * char.walkFactor;
    const p = nav.closest(start);
    this.x = p.x;
    this.z = p.z;
    this.yaw = Math.PI;
    this.agent = nav.addAgent(p, this.speed);
    char.root.position.set(this.x, 0, this.z);
    this.opacity = fadeIn ? 0 : 1;
    char.setOpacity(this.opacity);
  }

  /** Stop briefly while walking (e.g. to scan a badge at the gates), then carry on. */
  pause(seconds: number, yaw: number): boolean {
    if (!this.agent || this.phase !== 'walking' || this.pauseTimer > 0) return false;
    this.pauseTimer = seconds;
    this.pauseYaw = yaw;
    this.agent.resetMoveTarget();
    return true;
  }

  /** Walk faster from now on (heading home). */
  hurry() {
    if (this.hurried) return;
    this.hurried = true;
    this.speed *= 1.3;
    if (this.agent) this.nav.setHurry(this.agent, this.speed);
  }

  /** Fade out where we stand (e.g. could not get through a crowd); becomes `gone`. */
  fadeOut() {
    if (this.phase === 'fading' || this.phase === 'gone') return;
    this.trans = null;
    this.phase = 'fading';
  }

  /** Leave the crowd but keep the character (e.g. when riding off on a bike). */
  release() {
    if (this.agent) {
      this.nav.removeAgent(this.agent);
      this.agent = null;
    }
    this.phase = 'gone';
  }

  get seated() {
    return this.phase === 'seated' || this.phase === 'sitting';
  }

  get arrived() {
    return this.phase === 'seated' || this.phase === 'standing';
  }

  get gone() {
    return this.phase === 'gone';
  }

  /** Stable identity for comparing goals. */
  static goalKey(g: Goal | null): string {
    if (!g) return '';
    switch (g.kind) {
      case 'seat':
        return `seat:${g.seat.id}`;
      case 'spot':
        return `spot:${g.spot.id}`;
      case 'point':
        return `point:${g.key}`;
      case 'exit':
        return 'exit';
    }
  }

  setGoal(goal: Goal) {
    if (Body.goalKey(goal) === Body.goalKey(this.goal) && goal.kind !== 'point') return;
    if (this.phase === 'fading' || this.phase === 'gone') return;
    // A point goal with the same key just updates the target position.
    if (goal.kind === 'point' && this.goal?.kind === 'point' && goal.key === this.goal.key) {
      this.goal = goal;
      if (this.agent && this.phase === 'walking') this.requestTarget(goal.pos);
      return;
    }
    this.goalAge = 0;
    this.gesture = null;
    if (this.phase === 'seated' || this.phase === 'sitting') {
      this.pendingGoal = goal;
      this.standUp();
      return;
    }
    if (this.phase === 'standingUp') {
      this.pendingGoal = goal;
      return;
    }
    this.startWalking(goal);
  }

  private startWalking(goal: Goal) {
    this.goal = goal;
    this.phase = 'walking';
    this.stuckTimer = 0;
    this.lastDist = Infinity;
    this.bestDist = Infinity;
    this.noProgress = 0;
    if (!this.agent) {
      this.agent = this.nav.addAgent(v2(this.x, this.z), this.speed);
      if (this.hurried) this.nav.setHurry(this.agent, this.speed);
    }
    this.requestTarget(this.targetOf(goal));
  }

  private requestTarget(p: Vec2) {
    const snapped = this.nav.closest(p);
    this.agent?.requestMoveTarget({ x: snapped.x, y: 0, z: snapped.z });
  }

  private targetOf(goal: Goal): Vec2 {
    switch (goal.kind) {
      case 'seat':
        return goal.seat.approach;
      case 'spot':
        return goal.spot.pos;
      case 'point':
      case 'exit':
        return goal.pos;
    }
  }

  private standUp() {
    const seat = this.goal?.kind === 'seat' ? this.goal.seat : null;
    const to = seat ? seat.approach : v2(this.x, this.z);
    this.phase = 'standingUp';
    this.char.play('idle', 0.2);
    this.trans = { from: v2(this.x, this.z), to, fromY: this.y, toY: 0, fromYaw: this.yaw, toYaw: this.yaw, t: 0, dur: 0.45 };
  }

  private sitDown(seat: Seat) {
    if (this.agent) {
      this.nav.removeAgent(this.agent);
      this.agent = null;
    }
    this.phase = 'sitting';
    const back = SEAT_BACK[seat.kind];
    const to = v2(seat.pos.x - Math.sin(seat.yaw) * back, seat.pos.z - Math.cos(seat.yaw) * back);
    this.trans = { from: v2(this.x, this.z), to, fromY: 0, toY: seat.y ?? SEAT_Y[seat.kind], fromYaw: this.yaw, toYaw: seat.yaw, t: 0, dur: 0.5 };
    this.char.play('sit', 0.25);
  }

  /** Start already sitting at a seat (for agents that exist when we connect). */
  placeSeated(seat: Seat) {
    this.goal = { kind: 'seat', seat };
    this.x = seat.approach.x;
    this.z = seat.approach.z;
    this.sitDown(seat);
    if (this.trans) this.trans.t = this.trans.dur;
    this.yaw = seat.yaw;
    this.opacity = 1;
  }

  update(dt: number, time: number, pose: Pose) {
    this.goalAge += dt;
    // Fade in on spawn, out on exit.
    if (this.phase === 'fading') {
      this.opacity -= dt * 1.6;
      if (this.opacity <= 0) {
        this.opacity = 0;
        this.phase = 'gone';
        if (this.agent) {
          this.nav.removeAgent(this.agent);
          this.agent = null;
        }
      }
    } else if (this.opacity < 1) {
      this.opacity = Math.min(1, this.opacity + dt * 1.6);
    }
    this.char.setOpacity(this.opacity);

    if (this.trans) {
      const tr = this.trans;
      tr.t += dt;
      const k = Math.min(1, tr.t / tr.dur);
      const e = k * k * (3 - 2 * k);
      this.x = tr.from.x + (tr.to.x - tr.from.x) * e;
      this.z = tr.from.z + (tr.to.z - tr.from.z) * e;
      this.y = tr.fromY + (tr.toY - tr.fromY) * e;
      this.yaw = dampAngle(this.yaw, tr.toYaw, 12, dt);
      if (k >= 1) {
        this.trans = null;
        if (this.phase === 'sitting') this.phase = 'seated';
        else if (this.phase === 'standingUp') {
          this.phase = 'standing';
          const next = this.pendingGoal;
          this.pendingGoal = null;
          if (next) this.startWalking(next);
        }
      }
    } else if (this.agent && (this.phase === 'walking' || this.phase === 'standing')) {
      const p = this.agent.position();
      const vel = this.agent.velocity();
      const speed = Math.hypot(vel.x, vel.z);
      this.x = p.x;
      this.z = p.z;
      this.y = damp(this.y, 0, 10, dt);
      if (speed > 0.15) this.yaw = dampAngle(this.yaw, yawTowards(vel.x, vel.z), 10, dt);

      if (this.phase === 'walking' && this.goal && this.pauseTimer > 0) {
        this.pauseTimer -= dt;
        this.yaw = dampAngle(this.yaw, this.pauseYaw, 10, dt);
        this.char.play('interact-right', 0.15);
        if (this.pauseTimer <= 0) this.requestTarget(this.targetOf(this.goal));
      } else if (this.phase === 'walking' && this.goal) {
        if (speed > 0.1) {
          this.char.play('walk', 0.2);
          this.char.setWalkSpeed(speed);
        } else {
          this.char.play('idle', 0.3);
        }
        this.checkArrival(dt, speed);
      } else if (this.phase === 'standing') {
        const faceYaw = this.faceYaw();
        if (speed > 0.25) {
          this.char.play('walk', 0.2);
          this.char.setWalkSpeed(speed);
        } else {
          if (faceYaw !== null) this.yaw = dampAngle(this.yaw, faceYaw, 6, dt);
          const interact = this.goal?.kind === 'spot' && this.goal.spot.interact;
          this.char.play(this.gesture ?? (interact ? 'interact-right' : 'idle'), 0.3);
        }
      }
    }

    this.char.root.position.set(this.x, this.y, this.z);
    this.char.root.rotation.y = this.yaw;
    const seated = this.phase === 'seated';
    this.char.update(dt, seated ? { ...pose, seated, lap: this.goal?.kind === 'seat' && this.goal.seat.kind === 'lap' } : { handUp: pose.handUp, shake: pose.shake, ride: pose.ride, sweep: pose.sweep, wipe: pose.wipe }, time);
  }

  private faceYaw(): number | null {
    const g = this.goal;
    if (!g) return null;
    if (g.kind === 'spot') return g.spot.yaw;
    if (g.kind === 'point' && g.yaw !== undefined) return g.yaw;
    return null;
  }

  private checkArrival(dt: number, speed: number) {
    const g = this.goal!;
    const target = this.targetOf(g);
    const d = dist2(v2(this.x, this.z), target);
    // Crowded goals: accept arrival when close and not making progress.
    if (d < this.bestDist - 0.3) {
      this.bestDist = d;
      this.noProgress = 0;
    } else {
      this.noProgress += dt;
    }
    if (d < this.lastDist - 0.05) {
      this.lastDist = d;
      this.stuckTimer = 0;
    } else {
      this.stuckTimer += dt;
    }
    // Stuck in a jam (e.g. opposing flows in a doorway): squeeze past like people do.
    const jammed = this.stuckTimer > 3 && d > 1.3;
    if (jammed !== this.squeezed && this.agent) {
      this.squeezed = jammed;
      this.nav.setSqueezed(this.agent, jammed);
      if (!jammed && this.hurried) this.nav.setHurry(this.agent, this.speed);
    }
    // Getting into a vehicle: close enough to the door counts.
    const arriveDist = g.kind === 'exit' ? 1.4 : ARRIVE_DIST;
    const closeEnough = d < arriveDist || (d < 1.3 && speed < 0.2 && this.stuckTimer > 0.8) || (d < 3 && this.noProgress > 6);
    if (!closeEnough) {
      // Last resort: wedged somewhere for a long time (dead-end pocket, gridlock) → hop onto the target.
      if (this.noProgress > 20 && this.agent) {
        const p = this.nav.closest(target);
        this.agent.teleport({ x: p.x, y: 0, z: p.z });
        this.requestTarget(target);
        this.noProgress = 0;
        this.bestDist = Infinity;
        return;
      }
      if (this.stuckTimer > 4) {
        this.requestTarget(target);
        this.stuckTimer = 2;
      }
      return;
    }
    if (this.squeezed && this.agent) {
      this.squeezed = false;
      this.nav.setSqueezed(this.agent, false);
      if (this.hurried) this.nav.setHurry(this.agent, this.speed);
    }
    switch (g.kind) {
      case 'seat':
        this.sitDown(g.seat);
        break;
      case 'exit':
        this.phase = 'fading';
        break;
      default:
        this.phase = 'standing';
        this.char.play('idle', 0.3);
    }
  }

  dispose() {
    if (this.agent) {
      this.nav.removeAgent(this.agent);
      this.agent = null;
    }
    this.char.dispose();
  }
}
