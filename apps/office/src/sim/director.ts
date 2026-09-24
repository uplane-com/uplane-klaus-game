import * as THREE from 'three';
import { DEPTS, ROLES, TOOL_ROOMS } from '@office/events';
import type { AgentEvent } from '@office/events';
import type { Navigation } from '../nav/navigation';
import { MAX_AGENTS } from '../nav/navigation';
import type { TransportMode } from '../config/transport';
import type { Character, CharacterLibrary } from '../render/characters';
import type { OfficeView } from '../render/office';
import { FloorRings, StatusIcons, type IconName } from '../render/overlays';
import { dist2, v2, yawTowards, type Vec2 } from '../util/math';
import { Rng } from '../util/rng';
import type { BikeSlot, OfficeLayout, RoomLayout, Seat, Spot } from '../world/layout';
import { Body, type Goal } from './body';
import type { AgentRecord, AgentStore } from './store';
import type { Ticket, TransportSystem } from './transport';
import type { Turnstiles } from '../render/turnstiles';

/**
 * Maps agent state (from the store) to physical behaviour: which desk an
 * agent owns, when it walks to a tool room, a meeting, the coffee lounge,
 * to a colleague for a handoff, or out of the building.
 */

interface Delivery {
  toId: string;
  startedAt: number;
  handingOver: number;
}

export interface Actor {
  id: string;
  slot: number;
  rec: AgentRecord;
  body: Body;
  desk: Seat | null;
  /** Current non-desk reservation (meeting seat, lounge seat, tool spot). */
  away: Seat | Spot | null;
  delivery: Delivery | null;
  /** Whether this idle episode is spent in the lounge. */
  breakRoll: number;
  lastActivitySince: number;
  spawnedAt: number;
  /** Has reached a destination at least once (i.e. finished arriving at the office). */
  settled: boolean;
  thinkTimer: number;
  arrivedBy: TransportMode | null;
  /** Bike/scooter this agent parked at the rack. */
  bikeSlot: BikeSlot | null;
  /** How this agent is getting home. */
  ticket: Ticket | null;
  /** Handed over to the transport system (riding away). */
  riding: boolean;
  /** Last time this agent scanned its badge at the lobby gates. */
  lastScan: number;
}

const TOOL_TRIP_DELAY = 1.2;
const BREAK_DELAY = 2.5;

const SCREEN_COLORS: Record<string, string> = {
  working: '#4f9dff',
  thinking: '#9b87f5',
  tool: '#35c7c7',
  blocked: '#ffb020',
  error: '#ff4d4f',
  messaging: '#3ecf8e',
  away: '#33405a',
  empty: '#1b2130',
};

export class Director {
  readonly actors = new Map<string, Actor>();
  readonly icons = new StatusIcons(MAX_AGENTS);
  readonly rings = new FloorRings(MAX_AGENTS);
  private readonly freeSlots: number[] = [];
  private readonly meetingRooms = new Map<string, string>();
  private readonly rng = new Rng(99);
  private time = 0;
  private readonly workRooms: RoomLayout[];
  /** Agents on their way in (in a vehicle); they get a body when they step out. */
  private readonly arriving = new Map<string, Character>();
  private transport!: TransportSystem;
  private gates: Turnstiles | null = null;

  constructor(
    private readonly store: AgentStore,
    private readonly layout: OfficeLayout,
    private readonly nav: Navigation,
    private readonly chars: CharacterLibrary,
    private readonly scene: THREE.Scene,
    private readonly office: OfficeView,
  ) {
    for (let i = MAX_AGENTS - 1; i >= 0; i--) this.freeSlots.push(i);
    scene.add(this.icons.points, this.rings.mesh, this.rings.selection);
    this.workRooms = [...layout.rooms.values()].filter((r) => r.def.kind === 'work');
    store.subscribe((e) => this.onEvent(e));
  }

  attachTransport(t: TransportSystem) {
    this.transport = t;
  }

  attachGates(g: Turnstiles) {
    this.gates = g;
  }

  /** Called when someone scans in at the lobby gates on their way into the building. */
  onEnter: ((x: number, z: number) => void) | null = null;

  /** Everyone passing the lobby gates stops briefly to scan their badge. */
  private checkGates(a: Actor) {
    const g = this.gates;
    if (!g || a.body.phase !== 'walking' || this.time - a.lastScan < 5) return;
    const lane = g.laneAt(a.body.x, a.body.z);
    if (lane < 0) return;
    const facing = a.body.z > g.z ? Math.PI : 0;
    if (a.body.pause(0.8, facing)) {
      a.lastScan = this.time;
      g.scan(lane);
      // Coming from the street (south of the gates) = entering the building.
      if (a.body.z > g.z) this.onEnter?.(a.body.x, a.body.z);
    }
  }

  get arrivingCount() {
    return this.arriving.size;
  }

  // -- transport hooks ------------------------------------------------------

  characterInTransit(id: string): Character | null {
    return this.arriving.get(id) ?? null;
  }

  /** A passenger steps out of a vehicle (or off a bike) onto the plaza. */
  alight(id: string, pos: Vec2, mode: TransportMode, bikeSlot: BikeSlot | null) {
    const char = this.arriving.get(id);
    this.arriving.delete(id);
    if (!char) return;
    const actor = this.createActor(id, char, pos, mode !== 'bike' && mode !== 'scooter');
    if (!actor) {
      char.dispose();
      return;
    }
    actor.arrivedBy = mode;
    actor.bikeSlot = bikeSlot;
  }

  rideGone(id: string) {
    const a = this.actors.get(id);
    if (a) this.despawn(a);
  }

  private room(id: string) {
    return this.layout.rooms.get(id)!;
  }

  private onEvent(e: AgentEvent) {
    if (e.type === 'agent.started') {
      if (e.alreadyRunning) this.spawnSeated(e.agent.id);
      else {
        // New agents arrive by car, bus, bike, scooter or helicopter.
        this.arriving.set(e.agent.id, this.chars.create(e.agent.id));
        this.transport.enqueueArrival(e.agent.id);
      }
    } else if (e.type === 'agent.stopped' && this.arriving.has(e.agentId) && this.transport.cancelArrival(e.agentId)) {
      // Stopped before their ride even left: they never show up.
      this.arriving.get(e.agentId)!.dispose();
      this.arriving.delete(e.agentId);
      this.store.remove(e.agentId);
    }
  }

  private spawnSeated(id: string) {
    const actor = this.createActor(id, this.chars.create(id), this.layout.entrance.inside, true);
    if (!actor) return;
    if (actor.desk) actor.body.placeSeated(actor.desk);
    actor.settled = true;
  }

  private createActor(id: string, char: Character, start: Vec2, fadeIn: boolean): Actor | null {
    const rec = this.store.agents.get(id);
    const slot = this.freeSlots.pop();
    if (!rec || slot === undefined) {
      if (slot !== undefined) this.freeSlots.push(slot);
      return null;
    }
    this.scene.add(char.root);
    const body = new Body(this.nav, char, start, fadeIn);
    const actor: Actor = {
      id,
      slot,
      rec,
      body,
      desk: null,
      away: null,
      delivery: null,
      breakRoll: this.rng.float(),
      lastActivitySince: rec.activitySince,
      spawnedAt: this.time,
      settled: false,
      thinkTimer: this.rng.float(0, 0.3),
      arrivedBy: null,
      bikeSlot: null,
      ticket: null,
      riding: false,
      lastScan: -Infinity,
    };
    this.claimDesk(actor);
    this.actors.set(id, actor);
    return actor;
  }

  // -- reservations -------------------------------------------------------

  private claimDesk(a: Actor) {
    const role = ROLES[a.rec.role];
    const own = this.room(role.room).seats.filter((s) => s.kind === 'desk' && !s.occupant);
    let seat = own.length ? this.rng.pick(own) : null;
    if (!seat) {
      // Overflow: any free desk in the same department, then anywhere.
      const sameDept = this.workRooms.filter((r) => r.def.dept === role.dept).flatMap((r) => r.seats.filter((s) => s.kind === 'desk' && !s.occupant));
      const anyDesk = this.workRooms.flatMap((r) => r.seats.filter((s) => s.kind === 'desk' && !s.occupant));
      seat = sameDept[0] ?? anyDesk[0] ?? null;
    }
    if (seat) {
      seat.occupant = a.id;
      a.desk = seat;
    }
  }

  private releaseAway(a: Actor) {
    if (a.away) a.away.occupant = null;
    a.away = null;
  }

  private reserve<T extends Seat | Spot>(a: Actor, options: T[]): T | null {
    const free = options.filter((o) => !o.occupant);
    if (!free.length) return null;
    // Prefer something reasonably close, with some randomness.
    const here = v2(a.body.x, a.body.z);
    free.sort((p, q) => dist2(here, p.pos) - dist2(here, q.pos));
    const pick = free[Math.min(free.length - 1, this.rng.int(0, Math.min(3, free.length - 1)))];
    this.releaseAway(a);
    pick.occupant = a.id;
    a.away = pick;
    return pick;
  }

  // -- decisions ----------------------------------------------------------

  private desiredGoal(a: Actor): Goal | null {
    const rec = a.rec;
    const act = rec.activity;
    const actAge = (performance.now() - rec.activitySince) / 1000;

    // Deliveries (handoffs) take priority, even when about to leave.
    if (!a.delivery && rec.deliveries.length) {
      const d = rec.deliveries.shift()!;
      if (this.actors.has(d.toId)) a.delivery = { toId: d.toId, startedAt: this.time, handingOver: 0 };
    }
    if (a.delivery) {
      const target = this.actors.get(a.delivery.toId);
      if (!target || this.time - a.delivery.startedAt > 45 || target.body.gone) {
        a.delivery = null;
      } else {
        this.releaseAway(a);
        const tp = target.body.seated && target.desk ? target.desk.approach : v2(target.body.x, target.body.z);
        const dx = a.body.x - tp.x;
        const dz = a.body.z - tp.z;
        const len = Math.hypot(dx, dz) || 1;
        const standoff = target.body.seated ? 0.4 : 1.1;
        const pos = v2(tp.x + (dx / len) * standoff, tp.z + (dz / len) * standoff);
        return { kind: 'point', pos, yaw: yawTowards(target.body.x - pos.x, target.body.z - pos.z), key: `deliver:${target.id}` };
      }
    }

    if (rec.status === 'stopped') return this.departureGoal(a);

    switch (act.kind) {
      case 'meeting': {
        let roomId = this.meetingRooms.get(act.meetingId);
        if (!roomId) {
          // Ad team sessions happen at the studio's jam table when there's room.
          const creative = ROLES[a.rec.role].dept === 'ad';
          const rooms = [...this.layout.rooms.values()].filter((r) => r.def.kind === 'meeting' || (creative && r.def.kind === 'studio'));
          const free = (r: RoomLayout) => r.seats.filter((s) => !s.occupant).length + (r.def.kind === 'studio' && r.seats.some((s) => !s.occupant) ? 100 : 0);
          rooms.sort((p, q) => free(q) - free(p));
          roomId = rooms[0]?.def.id;
          if (roomId) this.meetingRooms.set(act.meetingId, roomId);
        }
        if (a.away && a.away.roomId === roomId && 'kind' in a.away) return { kind: 'seat', seat: a.away };
        const seat = roomId ? this.reserve(a, this.room(roomId).seats) : null;
        if (seat) return { kind: 'seat', seat };
        break;
      }
      case 'tool': {
        if (actAge < TOOL_TRIP_DELAY && !a.away) break;
        const roomId = TOOL_ROOMS[act.tool];
        const toolRoom = this.room(roomId);
        if (a.away && a.away.roomId === roomId) return 'kind' in a.away ? { kind: 'seat', seat: a.away } : { kind: 'spot', spot: a.away };
        // In the TV & podcast studio the talent sits (anchor desk, podcast table), crew stands.
        const pick = this.reserve(a, toolRoom.def.kind === 'media' ? [...toolRoom.seats, ...toolRoom.spots] : toolRoom.spots);
        if (pick) return 'kind' in pick ? { kind: 'seat', seat: pick } : { kind: 'spot', spot: pick };
        break;
      }
      case 'idle': {
        if (rec.task || actAge < BREAK_DELAY || a.breakRoll > 0.65) break;
        const lounge = this.room('lounge');
        if (a.away && a.away.roomId === 'lounge') return 'kind' in a.away ? { kind: 'seat', seat: a.away } : { kind: 'spot', spot: a.away };
        const options: (Seat | Spot)[] = [...lounge.seats, ...lounge.spots];
        const pick = this.reserve(a, options);
        if (pick) return 'kind' in pick ? { kind: 'seat', seat: pick } : { kind: 'spot', spot: pick };
        break;
      }
    }

    this.releaseAway(a);
    if (!a.desk) this.claimDesk(a);
    if (a.desk) return { kind: 'seat', seat: a.desk };
    // No desk available: wait in the lobby.
    const lobby = this.room('lobby');
    const wait = this.reserve(a, lobby.seats);
    return wait ? { kind: 'seat', seat: wait } : null;
  }

  /** Leaving: walk to the parked bike, or to a pick-up spot and into the vehicle. */
  private departureGoal(a: Actor): Goal {
    this.releaseAway(a);
    a.body.hurry();
    const t = (a.ticket ??= this.transport.requestDeparture(a.id, a.bikeSlot));
    if (t.mode === 'bike' && t.bikeSlot) {
      return { kind: 'point', pos: t.bikeSlot.approach, yaw: Math.PI, key: 'bike' };
    }
    if (t.boardAt) return { kind: 'exit', pos: t.boardAt };
    return { kind: 'spot', spot: t.spot! };
  }

  private updateDeparture(a: Actor) {
    const t = a.ticket;
    if (!t || a.riding) return;
    const g = a.body.goal;
    if (t.mode === 'bike' && a.body.arrived && g?.kind === 'point' && g.key === 'bike') {
      a.body.release();
      a.riding = true;
      this.icons.clear(a.slot);
      this.rings.clear(a.slot);
      if (!this.transport.rideAway(a.id, a.body.char)) this.despawn(a);
      return;
    }
    if (t.spot && a.body.arrived && g?.kind === 'spot' && g.spot === t.spot) t.ready = true;
  }

  // -- per frame ------------------------------------------------------------

  update(dt: number, zoomPx: number) {
    this.time += dt;
    for (const a of this.actors.values()) {
      if (a.riding) continue;
      if (a.rec.activitySince !== a.lastActivitySince) {
        a.lastActivitySince = a.rec.activitySince;
        if (a.rec.activity.kind === 'idle') a.breakRoll = this.rng.float();
        a.thinkTimer = 0;
      }
      a.thinkTimer -= dt;
      if (a.thinkTimer <= 0) {
        a.thinkTimer = 0.25;
        const goal = this.desiredGoal(a);
        if (goal) a.body.setGoal(goal);
      }

      this.updateDelivery(a, dt);
      this.updateDeparture(a);
      this.checkGates(a);
      if (a.riding) continue;

      const act = a.rec.activity.kind;
      const atDesk = a.body.seated && a.desk && a.body.goal?.kind === 'seat' && a.body.goal.seat === a.desk;
      a.body.gesture = a.delivery && a.body.arrived ? 'interact-right' : a.rec.activity.kind === 'error' && !a.body.seated ? 'emote-no' : null;
      a.body.update(dt, this.time, {
        typing: !!atDesk && (act === 'working' || act === 'messaging' || act === 'tool'),
        thinking: !!atDesk && act === 'thinking',
        handUp: act === 'blocked',
        shake: act === 'error',
      });

      if (a.body.arrived) a.settled = true;
      if (a.body.gone) {
        this.despawn(a);
        continue;
      }
      this.updateOverlays(a, !!atDesk);
    }
    this.icons.commit(this.time, zoomPx);
    this.rings.commit();
  }

  private updateDelivery(a: Actor, dt: number) {
    const d = a.delivery;
    if (!d || !a.body.arrived || a.body.goal?.kind !== 'point') return;
    d.handingOver += dt;
    if (d.handingOver > 1.8) a.delivery = null;
  }

  private updateOverlays(a: Actor, atDesk: boolean) {
    const b = a.body;
    const act = a.rec.activity;
    let icon: IconName | null = null;
    if (a.delivery) icon = 'handoff';
    else if (a.rec.status === 'stopped') icon = null;
    else if (!a.settled) icon = 'hello';
    else if (act.kind === 'tool') icon = act.tool;
    else if (act.kind === 'idle') icon = a.away?.roomId === 'lounge' ? 'idle' : null;
    else icon = act.kind;
    const pulse = act.kind === 'blocked' || act.kind === 'error';
    this.icons.set(a.slot, b.x, b.y + 2.05, b.z, b.opacity > 0.3 ? icon : null, pulse);
    this.rings.set(a.slot, b.x, b.z, DEPTS[ROLES[a.rec.role].dept].color);

    const mon = a.desk?.monitor;
    if (mon !== undefined) {
      const key = atDesk ? (SCREEN_COLORS[act.kind] ? act.kind : 'away') : 'away';
      this.office.setScreen(mon, SCREEN_COLORS[key]);
    }
  }

  private despawn(a: Actor) {
    if (a.ticket && !a.riding) this.transport.boarded(a.id);
    this.releaseAway(a);
    if (a.desk) {
      if (a.desk.monitor !== undefined) this.office.setScreen(a.desk.monitor, SCREEN_COLORS.empty);
      a.desk.occupant = null;
    }
    this.icons.clear(a.slot);
    this.rings.clear(a.slot);
    a.body.dispose();
    this.freeSlots.push(a.slot);
    this.actors.delete(a.id);
    this.store.remove(a.id);
  }

  /** Screen-space picking: nearest agent to a pointer position. */
  pick(camera: THREE.Camera, ndcX: number, ndcY: number, width: number, height: number): Actor | null {
    const v = new THREE.Vector3();
    let best: Actor | null = null;
    let bestD = 28;
    for (const a of this.actors.values()) {
      v.set(a.body.x, a.body.y + 0.9, a.body.z).project(camera);
      const dx = ((v.x - ndcX) * width) / 2;
      const dy = ((v.y - ndcY) * height) / 2;
      const d = Math.hypot(dx, dy);
      if (d < bestD) {
        bestD = d;
        best = a;
      }
    }
    return best;
  }

  /** Where an agent currently is, in words. */
  locationOf(a: Actor): string {
    for (const r of this.layout.rooms.values()) {
      if (a.body.x >= r.x0 && a.body.x <= r.x1 && a.body.z >= r.z0 && a.body.z <= r.z1) return r.def.name;
    }
    return a.body.z > 64 ? 'Plaza' : 'Hallway';
  }
}
