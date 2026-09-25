import * as THREE from 'three';
import { ARRIVAL_WEIGHTS, BUS_BAYS, BUS_STOP_X, CAR_SLOTS, HELIPAD, ROAD, type TransportMode } from '../config/transport';
import type { Character } from '../render/characters';
import { BUS_DOORS, type VehicleFactory, type VehicleMesh } from '../render/vehicles';
import { dampAngle, v2, yawTowards, type Vec2 } from '../util/math';
import { Rng } from '../util/rng';
import type { BikeSlot, OfficeLayout, Spot } from '../world/layout';

/**
 * Everything on the street: agents arrive by car, bus, bike, scooter or
 * (rarely) helicopter, and leave the same way. Cars and buses drive in the
 * curb lane, queue behind each other, stop at the curb, drop people off /
 * pick them up and drive away. Bikes get parked at the rack and ridden away
 * again by their owner.
 */

export interface TransportHooks {
  /** A passenger steps out onto the plaza. */
  alight(id: string, pos: Vec2, mode: TransportMode, bikeSlot: BikeSlot | null): void;
  /** Character of an agent in transit (riders are visible on their bike). */
  character(id: string): Character | null;
  /** A rider has left the scene. */
  rideGone(id: string): void;
}

export interface Ticket {
  id: string;
  mode: 'car' | 'bus' | 'bike';
  /** Where to wait (car/bus). */
  spot: Spot | null;
  bikeSlot: BikeSlot | null;
  /** Agent is standing at its spot. */
  ready: boolean;
  /** Set when a vehicle is waiting: walk here and get in. */
  boardAt: Vec2 | null;
  boarded: boolean;
  vehicle: RoadVehicle | null;
}

const CRUISE = { car: 11, bus: 8, ambient: 11 } as const;

/** Uplane blue is the house line, the others are city buses. */
const BUS_LIVERIES = ['#1a44ff', '#1a44ff', '#e63946', '#2a9d8f', '#f4a261', '#ffd23f'];

const VEHICLE_COLORS = ['#ff5c5c', '#1a44ff', '#3ecf8e', '#ffb020', '#9b5de5', '#f15bb5', '#00bbf9', '#ff8a5b', '#2b2f38', '#f4f5f8', '#7bd389', '#ffd23f'];
const ACCEL = 5;
const DECEL = 7;

class RoadVehicle {
  x: number;
  z: number;
  speed: number;
  state: 'drive' | 'dwell' | 'leave' = 'drive';
  dwellTimer = 0;
  alightTimer = 0;
  boardingStarted = false;
  /** Done at the curb; waiting for a gap in traffic to pull out. */
  readyToLeave = false;
  /** Buses keep collecting waiting passengers while at the stop. */
  pickupOpen = false;
  readonly dir: 1 | -1;

  constructor(
    readonly kind: 'car' | 'bus' | 'ambient',
    readonly mesh: VehicleMesh,
    readonly stopX: number | null,
    readonly dropoff: string[],
    readonly pickup: Ticket[],
    readonly slot: number,
  ) {
    // Right-hand traffic: arrivals drive west in the curb lane, through traffic east in the far lane.
    this.dir = kind === 'ambient' ? 1 : -1;
    this.x = this.dir === 1 ? ROAD.spawnX : ROAD.despawnX;
    this.z = this.dir === -1 ? ROAD.laneZ : ROAD.oppositeLaneZ;
    this.speed = CRUISE[kind];
    mesh.root.rotation.y = this.dir === 1 ? Math.PI / 2 : -Math.PI / 2;
  }

  /** Front door position on the curb side. */
  get door(): Vec2 {
    const forward = this.kind === 'bus' ? BUS_DOORS[0] : 0;
    return v2(this.x + this.dir * forward, ROAD.alightZ);
  }

  get done() {
    return this.dir === 1 ? this.x > ROAD.despawnX : this.x < ROAD.spawnX;
  }
}

class Rider {
  pos: Vec2;
  yaw: number;
  idx = 0;
  speed = 0;
  finished = false;

  constructor(
    readonly id: string,
    readonly mode: 'bike' | 'scooter',
    readonly mesh: VehicleMesh,
    readonly char: Character | null,
    readonly path: Vec2[],
    readonly slot: BikeSlot,
    readonly arriving: boolean,
  ) {
    this.pos = { ...path[0] };
    this.yaw = yawTowards(path[1].x - path[0].x, path[1].z - path[0].z);
  }
}

class Heli {
  pos = new THREE.Vector3(170, 45, 20);
  phase: 'in' | 'descend' | 'dwell' | 'ascend' | 'out' = 'in';
  timer = 0;
  yaw = -Math.PI / 2;
  rotorSpeed = 30;

  constructor(
    readonly mesh: VehicleMesh,
    readonly passengers: string[],
  ) {}
}

interface Pending {
  id: string;
  mode: TransportMode;
  since: number;
  slot: BikeSlot | null;
}

export class TransportSystem {
  private readonly rng = new Rng(7);
  private readonly pending: Pending[] = [];
  private readonly road: RoadVehicle[] = [];
  private readonly riders: Rider[] = [];
  private readonly parked = new Map<BikeSlot, { mesh: VehicleMesh; mode: 'bike' | 'scooter' }>();
  private readonly tickets = new Map<string, Ticket>();
  private readonly slotBusy: boolean[] = CAR_SLOTS.map(() => false);
  private heli: Heli | null = null;
  private heliCooldown = 20;
  private ambientTimer = 3;
  private time = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly layout: OfficeLayout,
    private readonly factory: VehicleFactory,
    private readonly hooks: TransportHooks,
  ) {}

  get inTransit() {
    return this.pending.length + this.road.reduce((n, v) => n + v.dropoff.length, 0) + this.riders.filter((r) => r.arriving).length + (this.heli?.passengers.length ?? 0);
  }

  // -- arrivals -------------------------------------------------------------

  enqueueArrival(id: string) {
    let mode = this.rng.weighted(Object.keys(ARRIVAL_WEIGHTS) as TransportMode[], (m) => ARRIVAL_WEIGHTS[m]);
    // Rush hour: lots of people waiting → more buses.
    if (this.pending.length > 8 && this.rng.chance(0.5)) mode = 'bus';
    if (mode === 'heli' && (this.heli || this.heliCooldown > 0)) mode = 'car';
    let slot: BikeSlot | null = null;
    if (mode === 'bike' || mode === 'scooter') {
      slot = this.layout.transport.bikeSlots.find((s) => !s.occupant) ?? null;
      if (slot) slot.occupant = id;
      else mode = 'car';
    }
    this.pending.push({ id, mode, since: this.time, slot });
  }

  /** Agent stopped before arriving: forget them if they are not on their way yet. */
  cancelArrival(id: string): boolean {
    const i = this.pending.findIndex((p) => p.id === id);
    if (i < 0) return false;
    const [p] = this.pending.splice(i, 1);
    if (p.slot) p.slot.occupant = null;
    return true;
  }

  private dispatchArrivals() {
    const take = (mode: TransportMode, max: number) => {
      const out: Pending[] = [];
      for (let i = 0; i < this.pending.length && out.length < max; ) {
        if (this.pending[i].mode === mode) out.push(...this.pending.splice(i, 1));
        else i++;
      }
      return out;
    };
    const oldest = (mode: TransportMode) => this.pending.find((p) => p.mode === mode);

    const bus = oldest('bus');
    const busCount = this.pending.filter((p) => p.mode === 'bus').length;
    // Only send a bus when a bay is free (two buses in one bay would overlap).
    const usedBays = new Set(this.road.filter((v) => v.kind === 'bus' && v.state !== 'leave').map((v) => v.stopX));
    const bay = BUS_BAYS.find((x) => !usedBays.has(x));
    if (bus && bay !== undefined && (busCount >= 14 || this.time - bus.since > 3)) {
      const riders = take('bus', 20);
      this.spawnRoad('bus', bay, riders.map((p) => p.id), [], -1).pickupOpen = true;
    }

    // Only send a car when a curb slot is free; otherwise riders wait a moment longer.
    const car = oldest('car');
    const k = car && this.time - car.since > 0.5 ? this.freeSlot() : -1;
    if (k >= 0) {
      const riders = take('car', this.rng.int(1, 3));
      this.spawnRoad('car', CAR_SLOTS[k], riders.map((p) => p.id), [], k);
    }

    for (const mode of ['bike', 'scooter'] as const) {
      for (const p of take(mode, 99)) this.spawnRider(p.id, mode, p.slot!);
    }

    const heli = oldest('heli');
    if (heli && !this.heli) {
      const riders = take('heli', 2);
      this.heli = new Heli(this.factory.helicopter(this.rng.pick(['#1a44ff', '#ff5c5c', '#2b2f38', '#ffb020', '#3ecf8e'])), riders.map((p) => p.id));
      this.scene.add(this.heli.mesh.root);
      this.heliCooldown = 60;
    }
  }

  private freeSlot(): number {
    const free = CAR_SLOTS.map((_, k) => k).filter((k) => !this.slotBusy[k] && !this.layout.transport.carWait[k].occupant);
    if (!free.length) return -1;
    const k = this.rng.pick(free);
    this.slotBusy[k] = true;
    return k;
  }

  private spawnRoad(kind: 'car' | 'bus' | 'ambient', stopX: number | null, dropoff: string[], pickup: Ticket[], slot: number) {
    const mesh = kind === 'bus' ? this.factory.bus(this.rng.pick(BUS_LIVERIES)) : this.factory.car(`${kind}-${this.time}-${this.rng.float()}`);
    const v = new RoadVehicle(kind, mesh, stopX, dropoff, pickup, slot);
    // Join at the back of any queue at the entry point instead of spawning inside it.
    // Bounded, with a tolerance: float rounding could otherwise re-trigger the same move forever.
    for (let moved = true, pass = 0; moved && pass < 50; pass++) {
      moved = false;
      for (const o of this.road) {
        if (o.dir !== v.dir || Math.abs(o.z - v.z) > o.mesh.halfWidth + v.mesh.halfWidth) continue;
        const gap = o.mesh.halfLength + v.mesh.halfLength + 4;
        if (Math.abs(o.x - v.x) >= gap - 1e-3) continue;
        v.x = o.x - v.dir * gap;
        // Join the queue at its speed instead of ramming it at cruise speed.
        v.speed = Math.min(v.speed, o.speed);
        moved = true;
      }
    }
    for (const t of pickup) t.vehicle = v;
    this.road.push(v);
    this.scene.add(mesh.root);
    return v;
  }

  private spawnRider(id: string, mode: 'bike' | 'scooter', slot: BikeSlot) {
    const color = this.rng.pick(VEHICLE_COLORS);
    const mesh = mode === 'bike' ? this.factory.bike(color) : this.factory.scooter(color);
    const laneZ = ROAD.bikeZ;
    const path = [v2(ROAD.despawnX, laneZ), v2(slot.pos.x + 3, laneZ), v2(slot.pos.x, ROAD.curbZ - 1.5), slot.pos];
    const char = this.hooks.character(id);
    if (char) this.scene.add(char.root);
    this.riders.push(new Rider(id, mode, mesh, char, path, slot, true));
    this.scene.add(mesh.root);
  }

  // -- departures ---------------------------------------------------------

  /** Decide how an agent leaves and where it should walk to. */
  requestDeparture(id: string, bikeSlot: BikeSlot | null): Ticket {
    const existing = this.tickets.get(id);
    if (existing) return existing;
    const t: Ticket = { id, mode: 'car', spot: null, bikeSlot: null, ready: false, boardAt: null, boarded: false, vehicle: null };
    if (bikeSlot && this.parked.has(bikeSlot)) {
      t.mode = 'bike';
      t.bikeSlot = bikeSlot;
    } else {
      const waiting = [...this.tickets.values()].filter((x) => x.mode !== 'bike' && !x.boarded).length;
      const carSpot = this.layout.transport.carWait.find((s, k) => !s.occupant && !this.slotBusy[k]);
      const wantBus = waiting > 10 || this.rng.chance(0.35) || !carSpot;
      const busSpot = this.layout.transport.busWait.find((s) => !s.occupant);
      if (wantBus && busSpot) {
        t.mode = 'bus';
        t.spot = busSpot;
      } else if (carSpot) {
        t.spot = carSpot;
      } else {
        // Everything is full: queue near the bus stop.
        t.mode = 'bus';
        t.spot = { id: `busx-${id}`, roomId: 'plaza', pos: v2(BUS_STOP_X + this.rng.float(-9, 6), ROAD.curbZ - this.rng.float(3.2, 7)), yaw: 0, interact: false, occupant: null };
      }
      t.spot.occupant = id;
    }
    this.tickets.set(id, t);
    return t;
  }

  /** Walked to the parked bike: hand the character to the bike and ride off. */
  rideAway(id: string, char: Character) {
    const t = this.tickets.get(id);
    const slot = t?.bikeSlot;
    const parked = slot ? this.parked.get(slot) : undefined;
    if (!t || !slot || !parked) return false;
    this.parked.delete(slot);
    slot.occupant = null;
    this.tickets.delete(id);
    const laneZ = ROAD.bikeZ;
    const path = [slot.pos, v2(slot.pos.x, slot.pos.z + 1.6), v2(slot.pos.x - 2, ROAD.curbZ - 1.2), v2(slot.pos.x - 5, laneZ), v2(ROAD.spawnX, laneZ)];
    this.riders.push(new Rider(id, parked.mode, parked.mesh, char, path, slot, false));
    return true;
  }

  /** Called when a boarding agent has disappeared into its vehicle. */
  boarded(id: string) {
    const t = this.tickets.get(id);
    if (!t) return;
    t.boarded = true;
    if (t.spot) t.spot.occupant = null;
    this.tickets.delete(id);
  }

  private dispatchPickups() {
    // Dispatch as soon as someone heads out (not when they arrive at the curb), so the
    // vehicle pulls up roughly when they get there.
    const ready = [...this.tickets.values()].filter((t) => !t.vehicle && !t.boarded && t.mode !== 'bike');
    const carWait = this.layout.transport.carWait;
    for (const t of ready.filter((x) => x.mode === 'car')) {
      if (t.vehicle) continue;
      const k = carWait.indexOf(t.spot!);
      if (k < 0 || this.slotBusy[k]) continue;
      // Car pools: also take up to two people waiting at neighbouring slots.
      const pool = [t];
      for (const o of ready) {
        if (pool.length >= 3) break;
        if (o === t || o.vehicle || o.mode !== 'car') continue;
        const ko = carWait.indexOf(o.spot!);
        if (ko >= 0 && Math.abs(CAR_SLOTS[ko] - CAR_SLOTS[k]) <= 13) pool.push(o);
      }
      this.slotBusy[k] = true;
      this.spawnRoad('car', CAR_SLOTS[k], [], pool, k);
    }

    // Buses: one per ~20 waiting people, up to one per bay.
    const unassigned = ready.filter((x) => x.mode === 'bus').length;
    const buses = this.road.filter((v) => v.kind === 'bus' && v.state !== 'leave' && v.pickupOpen);
    const capacity = buses.reduce((n, v) => n + (20 - v.pickup.length), 0);
    if (unassigned > capacity) {
      const used = new Set(buses.map((v) => v.stopX));
      const bay = BUS_BAYS.find((x) => !used.has(x));
      if (bay !== undefined) this.spawnRoad('bus', bay, [], [], -1).pickupOpen = true;
    }
  }

  // -- per frame ------------------------------------------------------------

  update(dt: number, time: number) {
    this.time += dt;
    this.heliCooldown -= dt;
    this.dispatchArrivals();
    this.dispatchPickups();

    this.ambientTimer -= dt;
    if (this.ambientTimer <= 0) {
      this.spawnRoad('ambient', null, [], [], -1);
      this.ambientTimer = this.rng.float(4, 10);
    }

    for (const v of this.road) this.updateRoad(v, dt);
    for (let i = this.road.length - 1; i >= 0; i--) {
      const v = this.road[i];
      if (v.done) {
        v.mesh.dispose();
        this.road.splice(i, 1);
      }
    }
    for (const r of this.riders) this.updateRider(r, dt, time);
    for (let i = this.riders.length - 1; i >= 0; i--) if (this.riders[i].finished) this.riders.splice(i, 1);
    if (this.heli) this.updateHeli(this.heli, dt);
  }

  private updateRoad(v: RoadVehicle, dt: number) {
    let target: number = CRUISE[v.kind];
    if (v.state === 'drive' && v.stopX !== null) {
      const dist = (v.stopX - v.x) * v.dir;
      target = Math.min(target, Math.sqrt(2 * DECEL * Math.max(0, dist - 0.05)));
      if (dist < 0.3 && v.speed < 1) {
        v.state = 'dwell';
        v.speed = 0;
        v.x = v.stopX;
      }
    }
    if (v.state === 'dwell') target = 0;

    // Keep distance to anything ahead that actually overlaps our path sideways
    // (a vehicle fully pulled over at the curb can be passed), or that sits in
    // the curb spot we are heading for.
    let gapLimit = Infinity;
    for (const o of this.road) {
      if (o === v || o.dir !== v.dir) continue;
      const ahead = (o.x - v.x) * v.dir;
      if (ahead <= 0) continue;
      const overlaps = Math.abs(o.z - v.z) < o.mesh.halfWidth + v.mesh.halfWidth + 0.2;
      const needSpot = v.stopX !== null && v.state === 'drive' && Math.abs(v.stopX - o.x) < o.mesh.halfLength + v.mesh.halfLength + 1;
      if (!overlaps && !needSpot) continue;
      const gap = ahead - o.mesh.halfLength - v.mesh.halfLength - 1.4;
      gapLimit = Math.min(gapLimit, Math.max(0, gap) * 1.8);
    }
    target = Math.min(target, gapLimit);
    const a = target > v.speed ? ACCEL : DECEL * 1.6;
    v.speed = Math.max(0, v.speed + Math.sign(target - v.speed) * Math.min(Math.abs(target - v.speed), a * dt));
    v.x += v.speed * v.dir * dt;

    // Pull in to the curb when stopping, back out when leaving.
    // Pull in towards the curb only once every parked vehicle between us and our spot has been
    // passed; otherwise we would drift sideways through the car or bus parked in the next spot.
    const nearStop = v.stopX !== null && v.state !== 'leave' && (v.stopX - v.x) * v.dir < 16 && !this.parkedBetween(v);
    const zTarget = v.dir === 1 ? ROAD.oppositeLaneZ : nearStop || v.state === 'dwell' ? ROAD.stopZ : ROAD.laneZ;
    v.z += (zTarget - v.z) * (1 - Math.exp(-3 * dt));

    if (v.state === 'dwell') {
      if (v.readyToLeave) {
        if (this.laneClear(v)) {
          v.state = 'leave';
          if (v.slot >= 0) this.slotBusy[v.slot] = false;
        }
      } else this.dwell(v, dt);
    }

    v.mesh.root.position.set(v.x, 0, v.z);
    const steer = (zTarget - v.z) * -0.12 * v.dir;
    v.mesh.root.rotation.y = (v.dir === 1 ? Math.PI / 2 : -Math.PI / 2) + steer;
    for (const w of v.mesh.wheels) w.obj.rotation.x += (v.speed * dt) / w.radius;
  }

  private dwell(v: RoadVehicle, dt: number) {
    v.dwellTimer += dt;
    // Drop passengers one by one.
    if (v.dropoff.length) {
      v.alightTimer -= dt;
      if (v.alightTimer <= 0) {
        const id = v.dropoff.shift()!;
        const d = v.door;
        this.hooks.alight(id, v2(d.x + this.rng.float(-0.4, 0.4), d.z), v.kind === 'bus' ? 'bus' : 'car', null);
        v.alightTimer = 0.45;
      }
      return;
    }
    if (!v.boardingStarted) {
      v.boardingStarted = true;
      v.dwellTimer = 0;
    }
    // Buses keep taking everyone who is waiting at the stop until full.
    if (v.kind === 'bus' && v.pickupOpen) {
      for (const t of this.tickets.values()) {
        if (v.pickup.length >= 20) break;
        if (t.mode === 'bus' && t.ready && !t.vehicle) {
          t.vehicle = v;
          v.pickup.push(t);
          v.dwellTimer = Math.min(v.dwellTimer, 6);
        }
      }
    }
    for (const t of v.pickup) {
      if (t.boardAt) continue;
      // Buses have doors along their whole length so a crowd can board in parallel.
      const d = v.door;
      t.boardAt = v.kind === 'bus' ? v2(v.x + v.dir * this.rng.pick(BUS_DOORS) + this.rng.float(-0.4, 0.4), d.z) : d;
    }
    const allIn = v.pickup.every((t) => t.boarded);
    if (allIn ? v.dwellTimer > 1.2 : v.dwellTimer > (v.kind === 'bus' ? 14 : 30)) {
      for (const t of v.pickup) {
        if (!t.boarded) {
          t.vehicle = null;
          t.boardAt = null;
        }
      }
      v.readyToLeave = true;
    }
  }

  /** A vehicle at the curb (or pulling in/out) between v and v's stop, or beside v. */
  private parkedBetween(v: RoadVehicle): boolean {
    for (const w of this.road) {
      if (w === v || w.dir !== v.dir) continue;
      if (Math.abs(w.z - ROAD.stopZ) > 1.2) continue; // only vehicles at/near the curb
      const rel = (w.x - v.x) * v.dir; // > 0: ahead of v
      const toStop = (v.stopX! - v.x) * v.dir;
      const reach = w.mesh.halfLength + v.mesh.halfLength + 0.8;
      // Beside or ahead of us, but not beyond our own stop spot (plus clearance).
      if (rel > -reach && rel < toStop - reach) return true;
    }
    return false;
  }

  /** Is there a gap in the travel lane to pull out of the curb? */
  private laneClear(v: RoadVehicle): boolean {
    for (const w of this.road) {
      if (w === v || w.dir !== v.dir || w.state === 'dwell') continue;
      if (Math.abs(w.z - ROAD.laneZ) > w.mesh.halfWidth + v.mesh.halfWidth) continue;
      const rel = (w.x - v.x) * v.dir;
      const clearance = w.mesh.halfLength + v.mesh.halfLength + 2;
      // Anyone alongside (even standing, e.g. a long bus queued next to us) or right in front.
      if (Math.abs(rel) < clearance) return false;
      // Someone coming up behind (vehicles standing still behind us are no danger).
      if (rel <= 0 && w.speed > 0.5 && -rel < clearance + w.speed * 1.6) return false;
    }
    return true;
  }

  private updateRider(r: Rider, dt: number, time: number) {
    const target = r.path[Math.min(r.idx + 1, r.path.length - 1)];
    const dx = target.x - r.pos.x;
    const dz = target.z - r.pos.z;
    const dist = Math.hypot(dx, dz);
    const last = r.idx + 1 >= r.path.length - 1;
    const cruise = r.mode === 'bike' ? 5.5 : 4.5;
    const want = last ? Math.min(cruise, Math.sqrt(2 * 3 * dist) + 0.2) : cruise;
    r.speed += Math.sign(want - r.speed) * Math.min(Math.abs(want - r.speed), 4 * dt);
    if (dist < 0.15) {
      r.idx++;
      if (r.idx >= r.path.length - 1) {
        this.finishRide(r);
        return;
      }
    } else {
      const step = Math.min(dist, r.speed * dt);
      r.pos.x += (dx / dist) * step;
      r.pos.z += (dz / dist) * step;
      r.yaw = dampAngle(r.yaw, yawTowards(dx, dz), 6, dt);
    }
    r.mesh.root.position.set(r.pos.x, 0, r.pos.z);
    r.mesh.root.rotation.y = r.yaw;
    for (const w of r.mesh.wheels) w.obj.rotation.x += (r.speed * dt) / w.radius;
    if (r.char) {
      const seatY = r.mode === 'bike' ? 0.34 : 0.24;
      const back = r.mode === 'bike' ? -0.28 : -0.05;
      r.char.root.position.set(r.pos.x + Math.sin(r.yaw) * back, seatY, r.pos.z + Math.cos(r.yaw) * back);
      r.char.root.rotation.y = r.yaw;
      r.char.setOpacity(1);
      r.char.play(r.mode === 'bike' ? 'sit' : 'idle', 0.2);
      r.char.update(dt, { ride: true, seated: r.mode === 'bike' }, time);
    }
  }

  private finishRide(r: Rider) {
    r.finished = true;
    if (r.arriving) {
      // Park the bike and hand the character over to the office.
      r.mesh.root.position.set(r.slot.pos.x, 0, r.slot.pos.z);
      r.mesh.root.rotation.y = Math.PI;
      this.parked.set(r.slot, { mesh: r.mesh, mode: r.mode });
      this.hooks.alight(r.id, r.slot.approach, r.mode, r.slot);
    } else {
      r.mesh.dispose();
      this.hooks.rideGone(r.id);
    }
  }

  private updateHeli(h: Heli, dt: number) {
    const pad = new THREE.Vector3(HELIPAD.x, 0, HELIPAD.z);
    const cruiseAlt = 14;
    const move = (to: THREE.Vector3, speed: number) => {
      const d = to.clone().sub(h.pos);
      const len = d.length();
      if (len < 0.05) return true;
      h.pos.addScaledVector(d, Math.min(1, (speed * dt) / len));
      if (Math.hypot(d.x, d.z) > 1) h.yaw = dampAngle(h.yaw, Math.atan2(d.x, d.z), 2, dt);
      return false;
    };
    switch (h.phase) {
      case 'in':
        if (move(new THREE.Vector3(pad.x, cruiseAlt, pad.z), 16)) h.phase = 'descend';
        break;
      case 'descend':
        if (move(pad, 3.5)) {
          h.phase = 'dwell';
          h.timer = 0;
        }
        break;
      case 'dwell':
        h.timer += dt;
        if (h.passengers.length && h.timer > 0.8) {
          const id = h.passengers.shift()!;
          this.hooks.alight(id, v2(pad.x + (h.passengers.length ? 1 : -1), pad.z - 5.4), 'heli', null);
          h.timer = 0.2;
        } else if (!h.passengers.length && h.timer > 2) {
          h.phase = 'ascend';
        }
        break;
      case 'ascend':
        if (move(new THREE.Vector3(pad.x, cruiseAlt, pad.z), 3.5)) h.phase = 'out';
        break;
      case 'out':
        if (move(new THREE.Vector3(-90, 45, 120), 18)) {
          h.mesh.dispose();
          this.heli = null;
          return;
        }
        break;
    }
    h.mesh.root.position.copy(h.pos);
    h.mesh.root.rotation.y = h.yaw;
    // Nose dips when flying forward, levels out when hovering.
    const cruising = h.phase === 'in' || h.phase === 'out';
    h.mesh.root.rotation.x += ((cruising ? 0.12 : 0) - h.mesh.root.rotation.x) * (1 - Math.exp(-2 * dt));
    for (const r of h.mesh.rotors ?? []) r.rotation.y += h.rotorSpeed * dt;
  }
}
