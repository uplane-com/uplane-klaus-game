import { BUILDING, ENTRANCE, HALLWAY_FLOOR, PLAZA, ROOMS, type RoomDef, type Side } from '../config/office';
import {
  AGENT_RADIUS,
  FURN,
  GLASS_WALL_HEIGHT,
  OBSTACLE_NAV_HEIGHT,
  WALL_HEIGHT,
  WALL_THICKNESS,
  type FurnitureModel,
} from '../config/scale';
import { BIKE_RACK, BUS_BAYS, BUS_STOP_X, CAR_SLOTS, HELIPAD, ROAD } from '../config/transport';
import { v2, type Vec2 } from '../util/math';
import { Rng } from '../util/rng';

/**
 * Turns the room config into concrete geometry data: walls, furniture
 * placements, navmesh obstacles, seats and standing spots. Pure data — no
 * three.js — so it can be shared by the renderer, the navmesh and the sim.
 */

/** Axis-aligned box. x/z are the centre, y is the base. */
export interface Box {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  y?: number;
}

/** Wall segment; interior walls are rendered as glass partitions. */
export interface Wall extends Box {
  outer: boolean;
}

export type FloorPattern = 'wood' | 'darkwood' | 'concrete' | 'terrazzo' | 'tiles' | 'pavers';

export interface Rug {
  x: number;
  z: number;
  w: number;
  d: number;
  color: string;
}

export interface Prop {
  kind: 'beanbag' | 'pingpong' | 'foosball' | 'lightbox' | 'floorLogo' | 'easel' | 'softbox' | 'cameraRig' | 'backdrop' | 'neon' | 'onAir' | 'foam' | 'mic' | 'newsDesk' | 'robotDock';
  x: number;
  z: number;
  rot: number;
  color?: string;
}

export interface Placement {
  model: FurnitureModel;
  x: number;
  z: number;
  /** Yaw; 0 = model front faces +z (south). */
  rot: number;
  y?: number;
}

export type SeatKind = 'desk' | 'meeting' | 'sofa' | 'chair';

export interface Seat {
  id: string;
  roomId: string;
  kind: SeatKind;
  pos: Vec2;
  /** Direction the seated agent faces. */
  yaw: number;
  /** Walkable point next to the seat where the agent leaves the crowd. */
  approach: Vec2;
  occupant: string | null;
  /** Index into layout.monitors for desk seats. */
  monitor?: number;
}

export interface Spot {
  id: string;
  roomId: string;
  pos: Vec2;
  yaw: number;
  /** Whether agents play an "interact" animation (e.g. at a rack or bookshelf). */
  interact: boolean;
  occupant: string | null;
}

export interface Door {
  x: number;
  z: number;
  side: Side;
  width: number;
  /** Point just inside the room. */
  inside: Vec2;
}

export interface RoomLayout {
  def: RoomDef;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  doors: Door[];
  seats: Seat[];
  spots: Spot[];
  labelPos: Vec2;
}

export interface Monitor {
  x: number;
  y: number;
  z: number;
  rot: number;
  seatId: string;
}

export interface Board {
  x: number;
  z: number;
  rot: number;
  w: number;
  kind: 'whiteboard' | 'moodboard' | 'kanban' | 'screen' | 'storyboard' | 'broadcast';
}

export interface ProcTable {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  round?: boolean;
}

export interface Tree {
  x: number;
  z: number;
  s: number;
}

export interface BikeSlot {
  /** Where the bike is parked. */
  pos: Vec2;
  /** Walkable point next to the bike where riders (dis)mount. */
  approach: Vec2;
  occupant: string | null;
}

export interface TransportLayout {
  /** Waiting spots at the bus stop. */
  busWait: Spot[];
  /** One waiting spot per car slot (same index as CAR_SLOTS). */
  carWait: Spot[];
  bikeSlots: BikeSlot[];
  shelter: Box;
}

export interface AlarmLamp {
  x: number;
  z: number;
  y: number;
}

export interface FloorRect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  color: string;
  y: number;
  pattern: FloorPattern;
}

export interface OfficeLayout {
  rooms: Map<string, RoomLayout>;
  walls: Wall[];
  rugs: Rug[];
  props: Prop[];
  obstacles: Box[];
  placements: Placement[];
  monitors: Monitor[];
  /** Additional always-on dashboard screens (command centre). */
  extraScreens: { x: number; y: number; z: number; rot: number }[];
  boards: Board[];
  racks: (Box & { face: 1 | -1 })[];
  tables: ProcTable[];
  trees: Tree[];
  floors: FloorRect[];
  bounds: { x0: number; z0: number; x1: number; z1: number };
  entrance: { inside: Vec2; outside: Vec2 };
  street: { x0: number; x1: number; z0: number; z1: number };
  transport: TransportLayout;
  /** Red beacon lamps for office-wide incident alerts. */
  alarms: AlarmLamp[];
  /** Lobby security gates (null if the office has no lobby). */
  turnstiles: { z: number; lanes: number[]; cabinets: number[]; barriers: Box[] } | null;
  /** Security posts (standing guards): server room doors + lobby gates. */
  guards: { x: number; z: number; yaw: number }[];
  /** Outside the east side exit: where housekeeping staff come and go. */
  serviceDoor: Vec2;
  /** Charging dock in the east hallway where the office robot waits. */
  robotDock: { x: number; z: number; yaw: number };
  /** Outdoor landscaping: planters along the façade, street lamps, a fountain, bushes. */
  landscape: { planters: Box[]; lamps: Vec2[]; fountain: { x: number; z: number; r: number } | null; bushes: Tree[]; indoorTrees: Tree[] };
  /** Reception staff seats (always occupied, not agents). */
  receptionists: { x: number; z: number; yaw: number }[];
}

// ---------------------------------------------------------------------------
// Dimensions

const DESK_W = FURN.desk.w;
const DESK_D = FURN.desk.d;
const DESK_H = FURN.desk.h;
/** Seat centre distance from the desk edge. */
const SEAT_GAP = 0.5;
/** Chair zone behind the desk that belongs to the pod obstacle. */
const CHAIR_ZONE = 0.95;
const POD_D = DESK_D * 2 + CHAIR_ZONE * 2;
const AISLE = 3.2;
const ROOM_MARGIN = 1.6;
/** How far past an obstacle edge a walkable approach point sits. */
const APPROACH_PAD = AGENT_RADIUS + 0.3;

const HALF_PI = Math.PI / 2;
/** Centre (z) of the side exits in the west and east building walls. */
const SIDE_EXIT_Z = 45;

/** Yaw for an agent/furniture front facing a direction. */
const FACE = { s: 0, n: Math.PI, e: HALF_PI, w: -HALF_PI } as const;

class RoomBuilder {
  readonly seats: Seat[] = [];
  readonly spots: Spot[] = [];
  private seatCounter = 0;
  private spotCounter = 0;

  constructor(
    readonly def: RoomDef,
    readonly out: OfficeLayout,
    readonly rng: Rng,
  ) {}

  get x0() {
    return this.def.x;
  }
  get z0() {
    return this.def.z;
  }
  get x1() {
    return this.def.x + this.def.w;
  }
  get z1() {
    return this.def.z + this.def.d;
  }

  place(model: FurnitureModel, x: number, z: number, rot: number, y?: number) {
    this.out.placements.push({ model, x, z, rot, y });
  }

  /** Place a model and register its footprint as a navmesh obstacle. */
  placeSolid(model: FurnitureModel, x: number, z: number, rot: number, pad = 0) {
    this.place(model, x, z, rot);
    const f = FURN[model];
    const sideways = Math.abs(Math.sin(rot)) > 0.5;
    this.obstacle(x, z, (sideways ? f.d : f.w) + pad, (sideways ? f.w : f.d) + pad);
  }

  obstacle(x: number, z: number, w: number, d: number, h = OBSTACLE_NAV_HEIGHT) {
    this.out.obstacles.push({ x, z, w, d, h });
  }

  seat(kind: SeatKind, pos: Vec2, yaw: number, approach: Vec2, monitor?: number): Seat {
    const s: Seat = {
      id: `${this.def.id}:seat${this.seatCounter++}`,
      roomId: this.def.id,
      kind,
      pos,
      yaw,
      approach,
      occupant: null,
      monitor,
    };
    this.seats.push(s);
    return s;
  }

  spot(pos: Vec2, yaw: number, interact: boolean): Spot {
    const s: Spot = {
      id: `${this.def.id}:spot${this.spotCounter++}`,
      roomId: this.def.id,
      pos,
      yaw,
      interact,
      occupant: null,
    };
    this.spots.push(s);
    return s;
  }

  hasDoor(side: Side) {
    return this.def.doors.some((d) => d.side === side);
  }

  /** A door-free wall, preferably opposite the (first) door – good for boards and TVs. */
  backSide(): Side {
    const s = this.def.doors[0]?.side ?? 's';
    const opposite = ({ n: 's', s: 'n', e: 'w', w: 'e' } as const)[s];
    const candidates: Side[] = [opposite, 'w', 'e', 'n', 's'];
    return candidates.find((c) => !this.hasDoor(c)) ?? opposite;
  }

  /** Position against the inside of a wall, `inset` away from its inner face. */
  againstWall(side: Side, t: number, inset: number): Vec2 {
    const half = WALL_THICKNESS / 2;
    switch (side) {
      case 'n':
        return v2(this.x0 + this.def.w * t, this.z0 + half + inset);
      case 's':
        return v2(this.x0 + this.def.w * t, this.z1 - half - inset);
      case 'w':
        return v2(this.x0 + half + inset, this.z0 + this.def.d * t);
      case 'e':
        return v2(this.x1 - half - inset, this.z0 + this.def.d * t);
    }
  }

  /** Tall plants flanking each door on the inside. */
  doorPlants() {
    for (const d of this.def.doors) {
      const horizontal = d.side === 'n' || d.side === 's';
      const along = (d.width ?? 3.6) / 2 + 0.7;
      const t = d.t ?? 0.5;
      for (const sgn of [-1, 1]) {
        const len = horizontal ? this.def.w : this.def.d;
        const p = this.againstWall(d.side, t + (sgn * along) / len, 0.45);
        this.placeSolid('pottedPlant', p.x, p.z, this.rng.float(0, 6));
      }
    }
  }

  cornerPlants() {
    const inset = 0.55;
    const corners: [number, number][] = [
      [this.x0 + inset + 0.2, this.z0 + inset + 0.2],
      [this.x1 - inset - 0.2, this.z0 + inset + 0.2],
      [this.x0 + inset + 0.2, this.z1 - inset - 0.2],
      [this.x1 - inset - 0.2, this.z1 - inset - 0.2],
    ];
    for (const [x, z] of corners) this.placeSolid('pottedPlant', x, z, this.rng.float(0, Math.PI * 2));
  }
}

// ---------------------------------------------------------------------------
// Room generators

function buildWorkRoom(rb: RoomBuilder) {
  const ix0 = rb.x0 + ROOM_MARGIN;
  const ix1 = rb.x1 - ROOM_MARGIN;
  const iz0 = rb.z0 + ROOM_MARGIN + 0.6;
  const iz1 = rb.z1 - ROOM_MARGIN - 0.6;
  const W = ix1 - ix0;
  const D = iz1 - iz0;

  let best = { n: 2, cols: 0, rows: 0, seats: 0 };
  for (let n = 5; n >= 2; n--) {
    const podW = n * DESK_W;
    const cols = Math.floor((W + AISLE) / (podW + AISLE));
    const rows = Math.floor((D + AISLE) / (POD_D + AISLE));
    const seats = cols * rows * n * 2;
    if (seats > best.seats) best = { n, cols, rows, seats };
  }
  const { n, cols, rows } = best;
  const podW = n * DESK_W;
  const gridW = cols * podW + (cols - 1) * AISLE;
  const gridD = rows * POD_D + (rows - 1) * AISLE;
  const gx0 = (ix0 + ix1) / 2 - gridW / 2;
  const gz0 = (iz0 + iz1) / 2 - gridD / 2;

  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const cx = gx0 + c * (podW + AISLE) + podW / 2;
      const cz = gz0 + r * (POD_D + AISLE) + POD_D / 2;
      buildDeskPod(rb, cx, cz, n);
    }
  }

  rb.cornerPlants();
  rb.doorPlants();
  const back = rb.backSide();
  const kind = rb.def.id === 'creative' ? 'moodboard' : rb.def.dept === 'eng' ? 'kanban' : 'whiteboard';
  addBoard(rb, back, 0.5, 4.2, kind);
  // A bookcase on each side wall for some texture.
  for (const side of ['w', 'e'] as const) {
    if (rb.hasDoor(side)) continue;
    const p = rb.againstWall(side, 0.5, FURN.bookcaseOpen.d / 2 + 0.05);
    rb.placeSolid('bookcaseOpen', p.x, p.z, FACE[side === 'w' ? 'e' : 'w']);
  }
}

const RUG_COLORS: Record<string, string[]> = {
  ad: ['#ffd9c7', '#ffe6a8', '#ffcfdf'],
  eng: ['#cfe0ff', '#d6f0e8', '#e3dcff'],
  comms: ['#cdeedd', '#fff0b3'],
  none: ['#e8e2d6'],
};

function buildDeskPod(rb: RoomBuilder, cx: number, cz: number, n: number, commandCenter = false) {
  const out = rb.out;
  const podW = n * DESK_W;
  rb.obstacle(cx, cz, podW, POD_D);
  out.rugs.push({ x: cx, z: cz, w: podW + 1.6, d: POD_D + 1.4, color: rb.rng.pick(RUG_COLORS[rb.def.dept ?? 'none']) });

  for (const row of [-1, 1] as const) {
    // row -1 = north half: agent sits north of the desk, facing south.
    const deskZ = cz + (row * DESK_D) / 2;
    const deskEdge = cz + row * DESK_D;
    const agentYaw = row === -1 ? FACE.s : FACE.n;
    for (let i = 0; i < n; i++) {
      const x = cx - podW / 2 + DESK_W * (i + 0.5);
      rb.place('desk', x, deskZ, agentYaw + Math.PI);
      // Monitor near the shared centre line, facing the agent.
      const monZ = deskZ - row * DESK_D * 0.18;
      const monitorIndex = out.monitors.length;
      out.monitors.push({ x, y: DESK_H, z: monZ, rot: agentYaw + Math.PI, seatId: '' });
      rb.place('computerScreen', x, monZ, agentYaw + Math.PI, DESK_H);
      if (commandCenter) addScreenWall(rb, x, monZ, agentYaw + Math.PI);
      rb.place('computerKeyboard', x, deskZ + row * DESK_D * 0.22, agentYaw + Math.PI, DESK_H);
      if (rb.rng.chance(0.3)) {
        const deco = rb.rng.pick(['plantSmall1', 'plantSmall2', 'plantSmall3', 'books', 'books'] as const);
        rb.place(deco, x + DESK_W * 0.36, deskZ + row * DESK_D * 0.1, rb.rng.float(0, 6.28), DESK_H);
      }

      const seatPos = v2(x, deskEdge + row * SEAT_GAP);
      rb.place('chairDesk', seatPos.x, seatPos.z, agentYaw);
      const approach = v2(x, cz + row * (POD_D / 2 + APPROACH_PAD));
      const seat = rb.seat('desk', seatPos, agentYaw, approach, monitorIndex);
      out.monitors[monitorIndex].seatId = seat.id;
    }
  }
}

/**
 * Command-centre setup: two angled side screens on the desk plus two more on
 * monitor arms above, all facing the operator.
 */
function addScreenWall(rb: RoomBuilder, x: number, z: number, rot: number) {
  // Local axes of the monitor: `side` is to the operator's left/right, `fwd` towards the operator.
  const side = { x: Math.cos(rot), z: -Math.sin(rot) };
  const fwd = { x: Math.sin(rot), z: Math.cos(rot) };
  const screens: [number, number, number, number][] = [
    // [lateral, forward, height, yaw offset]
    [-0.78, 0.2, DESK_H, 0.55],
    [0.78, 0.2, DESK_H, -0.55],
    [-0.42, 0.02, DESK_H + 0.62, 0.2],
    [0.42, 0.02, DESK_H + 0.62, -0.2],
  ];
  for (const [lat, f, y, dy] of screens) {
    const px = x + side.x * lat + fwd.x * f;
    const pz = z + side.z * lat + fwd.z * f;
    rb.place('computerScreen', px, pz, rot + dy, y);
    rb.out.extraScreens.push({ x: px, y, z: pz, rot: rot + dy });
  }
}

function addBoard(rb: RoomBuilder, side: Side, t: number, w: number, kind: Board['kind']) {
  const p = rb.againstWall(side, t, 0.12);
  const rot = FACE[({ n: 's', s: 'n', e: 'w', w: 'e' } as const)[side]];
  rb.out.boards.push({ x: p.x, z: p.z, rot, w, kind });
  const sideways = side === 'e' || side === 'w';
  rb.obstacle(p.x, p.z, sideways ? 0.4 : w, sideways ? w : 0.4);
}

function buildMeetingRoom(rb: RoomBuilder) {
  const cx = (rb.x0 + rb.x1) / 2;
  const cz = (rb.z0 + rb.z1) / 2;
  const alongX = rb.def.w >= rb.def.d;
  const long = (alongX ? rb.def.w : rb.def.d) - 7.5;
  const tableW = 2.6;
  const spacing = 1.9;
  const perSide = Math.max(2, Math.floor(long / spacing));
  const tableL = perSide * spacing;
  const tw = alongX ? tableL : tableW;
  const td = alongX ? tableW : tableL;
  rb.out.tables.push({ x: cx, z: cz, w: tw, d: td, h: 0.9 });
  const chairOut = 0.75;
  rb.obstacle(cx, cz, tw + (alongX ? 0 : chairOut * 2 + 0.4), td + (alongX ? chairOut * 2 + 0.4 : 0));

  const seatAt = (px: number, pz: number, faceDir: keyof typeof FACE, ax: number, az: number) => {
    const yaw = FACE[faceDir];
    rb.place('chairDesk', px, pz, yaw);
    rb.seat('meeting', v2(px, pz), yaw, v2(ax, az));
  };
  const pad = chairOut + 0.2 + APPROACH_PAD;
  for (let i = 0; i < perSide; i++) {
    const t = -tableL / 2 + spacing * (i + 0.5);
    if (alongX) {
      seatAt(cx + t, cz - tableW / 2 - chairOut, 's', cx + t, cz - tableW / 2 - pad);
      seatAt(cx + t, cz + tableW / 2 + chairOut, 'n', cx + t, cz + tableW / 2 + pad);
    } else {
      seatAt(cx - tableW / 2 - chairOut, cz + t, 'e', cx - tableW / 2 - pad, cz + t);
      seatAt(cx + tableW / 2 + chairOut, cz + t, 'w', cx + tableW / 2 + pad, cz + t);
    }
  }
  // Head seats at both ends.
  if (alongX) {
    seatAt(cx - tableL / 2 - chairOut, cz, 'e', cx - tableL / 2 - pad - 0.3, cz);
    seatAt(cx + tableL / 2 + chairOut, cz, 'w', cx + tableL / 2 + pad + 0.3, cz);
    rb.obstacle(cx - tableL / 2 - chairOut, cz, 1.0, 1.0);
    rb.obstacle(cx + tableL / 2 + chairOut, cz, 1.0, 1.0);
  } else {
    seatAt(cx, cz - tableL / 2 - chairOut, 's', cx, cz - tableL / 2 - pad - 0.3);
    seatAt(cx, cz + tableL / 2 + chairOut, 'n', cx, cz + tableL / 2 + pad + 0.3);
    rb.obstacle(cx, cz - tableL / 2 - chairOut, 1.0, 1.0);
    rb.obstacle(cx, cz + tableL / 2 + chairOut, 1.0, 1.0);
  }
  addBoard(rb, rb.backSide(), 0.5, 3.6, 'screen');
  rb.cornerPlants();
}

function buildLibrary(rb: RoomBuilder) {
  const bw = FURN.bookcaseClosedWide.w;
  const bd = FURN.bookcaseClosedWide.d;
  const back = rb.backSide();
  const sides: Side[] = (['n', 's', 'e', 'w'] as Side[]).filter((s) => !rb.hasDoor(s));
  for (const side of sides) {
    const len = side === 'n' || side === 's' ? rb.def.w : rb.def.d;
    const usable = len - 3.2;
    const count = Math.floor(usable / (bw + 0.3));
    const faceDir = ({ n: 's', s: 'n', e: 'w', w: 'e' } as const)[side];
    for (let i = 0; i < count; i++) {
      const t = (1.6 + (usable - count * (bw + 0.3)) / 2 + (bw + 0.3) * (i + 0.5)) / len;
      const p = rb.againstWall(side, t, bd / 2 + 0.05);
      rb.placeSolid('bookcaseClosedWide', p.x, p.z, FACE[faceDir], 0.1);
      const sp = rb.againstWall(side, t, bd + 0.1 + APPROACH_PAD);
      rb.spot(sp, FACE[side], true);
    }
  }
  // Reading table in the middle.
  const cx = (rb.x0 + rb.x1) / 2;
  const cz = (rb.z0 + rb.z1) / 2 + (back === 'n' ? 1 : -1);
  rb.out.tables.push({ x: cx, z: cz, w: 4.2, d: 2.0, h: 0.85 });
  rb.obstacle(cx, cz, 4.2, 2.0 + 1.8);
  for (const dx of [-1.2, 0, 1.2]) {
    for (const row of [-1, 1] as const) {
      const pz = cz + row * 1.55;
      const yaw = row === -1 ? FACE.s : FACE.n;
      rb.place('chairCushion', cx + dx, pz, yaw);
      rb.seat('chair', v2(cx + dx, pz), yaw, v2(cx + dx, cz + row * (1.9 + APPROACH_PAD)));
    }
  }
  rb.place('lampRoundFloor', rb.x0 + 1.2, rb.z1 - 1.3, 0);
  rb.place('lampRoundFloor', rb.x1 - 1.2, rb.z1 - 1.3, 0);
}

function buildServerRoom(rb: RoomBuilder) {
  const rackW = 1.3;
  const rackD = 1.0;
  const step = 1.4;
  const zStart = rb.z0 + 2.2;
  const count = 5;
  for (const [x, face] of [
    [rb.x0 + 4.2, 'e'],
    [rb.x1 - 4.2, 'w'],
  ] as const) {
    for (let i = 0; i < count; i++) {
      const z = zStart + step * (i + 0.5);
      const dir = face === 'e' ? 1 : -1;
      rb.out.racks.push({ x, z, w: rackD, d: rackW, h: 2.5, face: dir });
      rb.spot(v2(x + dir * (rackD / 2 + APPROACH_PAD + 0.1), z), FACE[face === 'e' ? 'w' : 'e'], true);
    }
    rb.obstacle(x, zStart + (count * step) / 2, rackD + 0.2, count * step + 0.2);
  }
  // Ops console (NOC) where the status monitor sits, facing the wall screen.
  buildDeskPod(rb, (rb.x0 + rb.x1) / 2, rb.z0 + 13.4, 2, true);
  const back = rb.backSide();
  addBoard(rb, back, 0.72, 3, 'screen');
}

function buildLounge(rb: RoomBuilder) {
  // Kitchen counter along the south wall.
  const counter: FurnitureModel[] = ['kitchenCabinet', 'kitchenSink', 'kitchenCabinet', 'kitchenCabinet', 'kitchenCabinet', 'kitchenFridge'];
  const cw = FURN.kitchenCabinet.w;
  let x = rb.x0 + 1.4;
  const cabD = FURN.kitchenCabinet.d;
  const zc = rb.z1 - WALL_THICKNESS / 2 - cabD / 2 - 0.05;
  counter.forEach((m, i) => {
    rb.place(m, x + cw / 2, m === 'kitchenFridge' ? rb.z1 - WALL_THICKNESS / 2 - FURN.kitchenFridge.d / 2 - 0.05 : zc, FACE.n);
    if (i === 2) rb.place('kitchenCoffeeMachine', x + cw / 2, zc + 0.1, FACE.n, FURN.kitchenCabinet.h);
    if (i === 3) rb.place('kitchenMicrowave', x + cw / 2, zc + 0.1, FACE.n, FURN.kitchenCabinet.h);
    if (i < counter.length - 1) rb.spot(v2(x + cw / 2, zc - cabD / 2 - APPROACH_PAD), FACE.s, i === 2 || i === 1);
    x += cw;
  });
  rb.obstacle(rb.x0 + 1.4 + (counter.length * cw) / 2, zc, counter.length * cw, cabD + 0.1);

  // High tables with standing spots.
  const tables = [
    [rb.x0 + 4.0, rb.z0 + 5.5],
    [rb.x0 + 9.5, rb.z0 + 5.5],
    [rb.x0 + 6.8, rb.z0 + 10.0],
  ];
  for (const [tx, tz] of tables) {
    rb.out.tables.push({ x: tx, z: tz, w: 1.2, d: 1.2, h: 1.15, round: true });
    rb.obstacle(tx, tz, 1.2, 1.2);
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + 0.4;
      const r = 0.6 + APPROACH_PAD;
      rb.spot(v2(tx + Math.sin(a) * r, tz + Math.cos(a) * r), a + Math.PI, false);
    }
  }

  // Two sofa groups on the east side.
  for (const gx of [rb.x1 - 11.5, rb.x1 - 5]) {
    const gz = (rb.z0 + rb.z1) / 2 + 0.5;
    rb.place('rugRectangle', gx, gz, HALF_PI);
    rb.placeSolid('tableCoffee', gx, gz, 0);
    for (const row of [-1, 1] as const) {
      const sz = gz + row * (FURN.tableCoffee.d / 2 + 1.6 + FURN.loungeSofa.d / 2);
      const yaw = row === -1 ? FACE.s : FACE.n;
      rb.placeSolid('loungeSofa', gx, sz, yaw);
      for (const dx of [-0.6, 0.6]) {
        const seatZ = sz - row * 0.15;
        rb.seat('sofa', v2(gx + dx, seatZ), yaw, v2(gx + dx, sz - row * (FURN.loungeSofa.d / 2 + APPROACH_PAD)));
      }
    }
  }
  rb.place('pottedPlant', rb.x1 - 1, rb.z0 + 1, 0);
  rb.place('pottedPlant', rb.x0 + 1, rb.z0 + 1, 1);
  rb.place('speaker', rb.x1 - 1, rb.z1 - 1, FACE.n);

  // Games corner: ping-pong + foosball, with player spots.
  const px = rb.x0 + 13.5;
  const pz = rb.z0 + 10;
  rb.out.props.push({ kind: 'pingpong', x: px, z: pz, rot: 0 });
  rb.obstacle(px, pz, 1.6, 2.8);
  rb.spot(v2(px, pz - 1.4 - APPROACH_PAD), FACE.s, true);
  rb.spot(v2(px, pz + 1.4 + APPROACH_PAD), FACE.n, true);
  const fx = rb.x0 + 13.5;
  const fz = rb.z0 + 4.2;
  rb.out.props.push({ kind: 'foosball', x: fx, z: fz, rot: 0 });
  rb.obstacle(fx, fz, 1.3, 0.8);
  rb.spot(v2(fx - 0.65 - APPROACH_PAD, fz), FACE.e, true);
  rb.spot(v2(fx + 0.65 + APPROACH_PAD, fz), FACE.w, true);
  // Bean bags by the sofas.
  const colors = ['#ff5c5c', '#ffb020', '#1a44ff', '#3ecf8e', '#9b5de5'];
  [
    [rb.x1 - 13.5, rb.z0 + 2.2],
    [rb.x1 - 12.1, rb.z0 + 3.2],
    [rb.x1 - 2.0, rb.z0 + 2.6],
  ].forEach(([x, z], i) => {
    rb.out.props.push({ kind: 'beanbag', x, z, rot: rb.rng.float(0, 6), color: colors[i % colors.length] });
    rb.obstacle(x, z, 1.1, 1.1);
  });
}

function buildLobby(rb: RoomBuilder) {
  // Reception counter facing the entrance.
  const rx = rb.x0 + rb.def.w / 2;
  const rz = rb.z0 + 6;
  for (const dx of [-DESK_W / 2, DESK_W / 2]) {
    // Staff sit on the north side facing the entrance, so the screens face north (towards them).
    rb.place('desk', rx + dx, rz, FACE.n);
    rb.place('computerScreen', rx + dx, rz + 0.2, FACE.n, DESK_H);
    rb.place('computerKeyboard', rx + dx, rz - DESK_D * 0.22, FACE.n, DESK_H);
  }
  rb.obstacle(rx, rz, DESK_W * 2, DESK_D + 0.2);
  // Two receptionists behind the counter, facing the entrance.
  for (const dx of [-DESK_W / 2, DESK_W / 2]) {
    const z = rz - DESK_D / 2 - 0.5;
    rb.place('chairDesk', rx + dx, z, FACE.s);
    rb.out.receptionists.push({ x: rx + dx, z, yaw: FACE.s });
  }
  rb.obstacle(rx, rz - DESK_D / 2 - 0.55, DESK_W * 2, 0.9);

  // Waiting sofas along the east wall.
  for (const t of [0.3, 0.62]) {
    const p = rb.againstWall('e', t, FURN.loungeSofa.d / 2 + 0.05);
    rb.placeSolid('loungeSofa', p.x, p.z, FACE.w);
    for (const dz of [-0.6, 0.6]) {
      rb.seat('sofa', v2(p.x + 0.15, p.z + dz), FACE.w, v2(p.x - FURN.loungeSofa.d / 2 - APPROACH_PAD, p.z + dz));
    }
  }
  rb.place('rugRectangle', ENTRANCE.x, rb.z1 - 2, 0);
  rb.placeSolid('pottedPlant', ENTRANCE.x - ENTRANCE.width / 2 - 0.7, rb.z1 - 0.8, 0);
  rb.placeSolid('pottedPlant', ENTRANCE.x + ENTRANCE.width / 2 + 0.7, rb.z1 - 0.8, 2);
  rb.placeSolid('coatRackStanding', rb.x0 + 1, rb.z1 - 1, 0);
  rb.out.props.push({ kind: 'floorLogo', x: ENTRANCE.x, z: rb.z1 - 6.9, rot: 0 });
  rb.out.props.push({ kind: 'lightbox', x: rx, z: rz - DESK_D / 2 - 1.6, rot: FACE.s });
  rb.obstacle(rx, rz - DESK_D / 2 - 1.6, 6.8, 0.5);
  for (const [x, z, c] of [
    [rb.x0 + 2.2, rb.z0 + 7.0, '#1a44ff'],
    [rb.x0 + 3.6, rb.z0 + 8.3, '#ffb020'],
    [rb.x0 + 2.0, rb.z0 + 9.5, '#3ecf8e'],
  ] as const) {
    rb.out.props.push({ kind: 'beanbag', x, z, rot: 0, color: c });
    rb.obstacle(x, z, 1.1, 1.1);
  }
  rb.placeSolid('pottedPlant', rb.x0 + 1, rb.z0 + 1, 0);
  rb.placeSolid('pottedPlant', rb.x1 - 1, rb.z0 + 1, 0);

  // Security gates: a glass barrier across the lobby with a bank of turnstiles.
  const gateZ = rb.z1 - 3.8;
  const lanes = 7;
  const pitch = 1.9;
  const lanesX = Array.from({ length: lanes }, (_, i) => ENTRANCE.x + (i - (lanes - 1) / 2) * pitch);
  const cabinets = Array.from({ length: lanes + 1 }, (_, i) => ENTRANCE.x + (i - lanes / 2) * pitch);
  for (const cx of cabinets) rb.obstacle(cx, gateZ, 0.28, 1.2);
  const left = cabinets[0] - 0.14;
  const right = cabinets[cabinets.length - 1] + 0.14;
  const wall = WALL_THICKNESS / 2;
  const barriers: Box[] = [
    { x: (rb.x0 + wall + left) / 2, z: gateZ, w: left - rb.x0 - wall, d: 0.12, h: 1.1 },
    { x: (right + rb.x1 - wall) / 2, z: gateZ, w: rb.x1 - wall - right, d: 0.12, h: 1.1 },
  ];
  for (const b of barriers) rb.obstacle(b.x, b.z, b.w, 0.3);
  rb.out.turnstiles = { z: gateZ, lanes: lanesX, cabinets, barriers };

  // Lobby security: one guard just inside the gates, watching the lanes.
  const guard = { x: rb.x0 + 3.2, z: gateZ - 1.3, yaw: 0.55 };
  rb.out.guards.push(guard);
  rb.obstacle(guard.x, guard.z, 0.9, 0.9);
}

/**
 * Creative loft: a brainstorm wall with a jam table, a sofa pit, easels, a
 * photo/video set and editing stations. Creative tool calls (brainstorm,
 * moodboard, photo shoot, video edit, image gen) send agents here, and ad
 * team meetings prefer the jam table.
 */
function buildStudio(rb: RoomBuilder) {
  const { x0, z0, x1, z1 } = rb;
  const cx = (x0 + x1) / 2;
  const colors = ['#ff5c5c', '#ffb020', '#1a44ff', '#3ecf8e', '#9b5de5', '#f15bb5'];

  // Brainstorm wall along the north side: boards with standing spots in front.
  const boards: [number, Board['kind']][] = [
    [0.2, 'moodboard'],
    [0.5, 'storyboard'],
    [0.8, 'moodboard'],
  ];
  for (const [t, kind] of boards) {
    addBoard(rb, 'n', t, 5, kind);
    for (const dx of [-1.2, 1.2]) {
      const p = rb.againstWall('n', t, 0.4 + APPROACH_PAD);
      rb.spot(v2(p.x + dx, p.z), FACE.n, true);
    }
  }

  // Jam table with stools.
  const tz = z0 + 8.2;
  const tableL = 7.6;
  rb.out.tables.push({ x: cx, z: tz, w: tableL, d: 2.2, h: 0.9 });
  rb.obstacle(cx, tz, tableL, 2.2 + 1.9);
  for (let i = 0; i < 4; i++) {
    const x = cx - tableL / 2 + (tableL / 4) * (i + 0.5);
    for (const row of [-1, 1] as const) {
      const pz = tz + row * 1.55;
      const yaw = row === -1 ? FACE.s : FACE.n;
      rb.place('chairCushion', x, pz, yaw);
      rb.seat('chair', v2(x, pz), yaw, v2(x, tz + row * (2.0 + APPROACH_PAD)));
    }
  }
  rb.place('laptop', cx - 1.8, tz - 0.3, FACE.s, 0.9);
  rb.place('laptop', cx + 1.2, tz + 0.35, FACE.n, 0.9);
  rb.place('books', cx + 0.2, tz, 0.4, 0.9);

  // Sofa pit in the middle, round rugs + bean bags.
  const pz = z0 + 20.5;
  const px = x0 + 8.5;
  rb.place('rugRound', px, pz, 0);
  rb.out.rugs.push({ x: px, z: pz, w: 8.2, d: 7.2, color: '#ffe0ec' });
  rb.placeSolid('tableCoffee', px, pz, 0);
  for (const row of [-1, 1] as const) {
    const sz = pz + row * (FURN.tableCoffee.d / 2 + 1.5 + FURN.loungeDesignSofa.d / 2);
    const yaw = row === -1 ? FACE.s : FACE.n;
    rb.placeSolid('loungeDesignSofa', px, sz, yaw);
    for (const dx of [-0.75, 0.75]) {
      rb.seat('sofa', v2(px + dx, sz - row * 0.15), yaw, v2(px + dx, sz - row * (FURN.loungeDesignSofa.d / 2 + APPROACH_PAD)));
    }
  }
  [
    [px + 4.3, pz - 1.6],
    [px + 4.6, pz + 0.2],
    [px + 4.1, pz + 1.9],
  ].forEach(([x, z], i) => {
    rb.out.props.push({ kind: 'beanbag', x, z, rot: rb.rng.float(0, 6), color: colors[(i + 2) % colors.length] });
    rb.obstacle(x, z, 1.1, 1.1);
  });

  // Free-standing neon sign behind the pit, facing the room.
  rb.out.props.push({ kind: 'neon', x: px, z: pz - 5.2, rot: FACE.s });
  rb.obstacle(px, pz - 5.2, 4.4, 0.4);

  // Stand-up idea tables between the pit and the editing bay.
  for (const [tx, tz] of [
    [x1 - 9.5, z0 + 17.5],
    [x1 - 9.5, z0 + 23.5],
  ]) {
    rb.out.tables.push({ x: tx, z: tz, w: 1.2, d: 1.2, h: 1.15, round: true });
    rb.obstacle(tx, tz, 1.2, 1.2);
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + 0.5;
      const r = 0.6 + APPROACH_PAD;
      rb.spot(v2(tx + Math.sin(a) * r, tz + Math.cos(a) * r), a + Math.PI, false);
    }
  }
  rb.out.rugs.push({ x: x1 - 9.5, z: z0 + 20.5, w: 5.5, d: 10, color: '#d9f2ff' });

  // Reference shelves (magazines, samples) on the outer wall behind the pit.
  for (const t of [0.44, 0.56]) {
    const p = rb.againstWall('w', t, FURN.bookcaseOpen.d / 2 + 0.05);
    rb.placeSolid('bookcaseOpen', p.x, p.z, FACE.e);
    rb.spot(rb.againstWall('w', t, FURN.bookcaseOpen.d + 0.1 + APPROACH_PAD), FACE.w, true);
  }

  // Editing bay: standing desks with big screens on the glass wall between the doors, facing into the room.
  for (const t of [0.44, 0.58]) {
    const p = rb.againstWall('e', t, 0.9);
    rb.out.tables.push({ x: p.x, z: p.z, w: 1.4, d: 3.0, h: 1.05 });
    rb.obstacle(p.x, p.z, 1.4, 3.0);
    for (const dz of [-0.75, 0.75]) {
      rb.place('computerScreen', p.x + 0.35, p.z + dz, FACE.w, 1.05);
      rb.out.extraScreens.push({ x: p.x + 0.35, y: 1.05, z: p.z + dz, rot: FACE.w });
      rb.spot(v2(p.x - 0.7 - APPROACH_PAD, p.z + dz), FACE.e, true);
    }
  }

  // Photo / video set in the south-east corner, facing into the room.
  const bx = x1 - 2.2;
  const bz = z1 - 4.4;
  rb.out.props.push({ kind: 'backdrop', x: bx, z: bz, rot: FACE.w, color: '#ffb3c7' });
  rb.obstacle(bx + 0.2, bz, 1.2, 4.8);
  for (const dz of [-3.0, 2.6]) {
    rb.out.props.push({ kind: 'softbox', x: bx - 3.2, z: bz + dz, rot: FACE.w + (dz < 0 ? 0.6 : -0.6) });
    rb.obstacle(bx - 3.2, bz + dz, 0.8, 0.8);
  }
  // "Talent" spots on the set, photographer behind the camera.
  rb.spot(v2(bx - 1.6, bz - 0.9), FACE.w, false);
  rb.spot(v2(bx - 1.6, bz + 0.9), FACE.w, false);
  const camX = bx - 6.4;
  rb.out.props.push({ kind: 'cameraRig', x: camX, z: bz, rot: FACE.e });
  rb.obstacle(camX, bz, 0.8, 0.8);
  rb.spot(v2(camX - 0.5 - APPROACH_PAD, bz), FACE.e, true);

  // Easels in the south-west corner; painters stand south of them so the canvases face the camera.
  for (let i = 0; i < 3; i++) {
    const ex = x0 + 4.2 + i * 2.8;
    const ez = z1 - 6.2 + (i % 2) * 1.0;
    rb.out.props.push({ kind: 'easel', x: ex, z: ez, rot: FACE.s + (i - 1) * 0.2, color: colors[i] });
    rb.obstacle(ex, ez, 1.0, 0.7);
    rb.spot(v2(ex, ez + 0.35 + APPROACH_PAD), FACE.n, true);
  }
  rb.out.rugs.push({ x: x0 + 7, z: z1 - 4.8, w: 9, d: 5, color: '#fff1b8' });

  // Greenery everywhere.
  rb.cornerPlants();
  for (const [x, z] of [
    [x0 + 1.2, z0 + 15],
    [x0 + 1.2, z0 + 27],
    [x1 - 1.2, z0 + 8],
  ]) {
    rb.placeSolid('pottedPlant', x, z, rb.rng.float(0, 6));
  }
  rb.place('lampRoundFloor', px - 3.4, pz - 2.6, 0);
  rb.place('speaker', x0 + 1, z0 + 30, FACE.e);
}

/**
 * TV & podcast studio: a podcast booth (round table with mics, acoustic foam)
 * on the west side and a news set (anchor desk, video wall, studio cameras,
 * control desk) on the east side. Talent sits, crew stands at the cameras.
 */
function buildMediaStudio(rb: RoomBuilder) {
  const { x0, z0, x1, z1 } = rb;
  const wall = WALL_THICKNESS / 2;

  // --- Podcast booth ---------------------------------------------------------
  const px = x0 + 6;
  const pz = (z0 + z1) / 2 + 0.5;
  rb.out.rugs.push({ x: px, z: pz, w: 6.4, d: 6.4, color: '#b86b4b' });
  rb.out.tables.push({ x: px, z: pz, w: 1.7, d: 1.7, h: 0.78, round: true });
  rb.obstacle(px, pz, 1.7 + 1.5, 1.7 + 1.5);
  for (const [dx, dz, face] of [
    [0, -1, 's'],
    [0, 1, 'n'],
    [-1, 0, 'e'],
    [1, 0, 'w'],
  ] as const) {
    const sx = px + dx * 1.4;
    const sz = pz + dz * 1.4;
    rb.place('chairCushion', sx, sz, FACE[face]);
    rb.seat('chair', v2(sx, sz), FACE[face], v2(px + dx * (1.6 + APPROACH_PAD + 0.25), pz + dz * (1.6 + APPROACH_PAD + 0.25)));
    // Mic on an arm in front of every seat.
    rb.out.props.push({ kind: 'mic', x: px + dx * 0.55, z: pz + dz * 0.55, rot: FACE[face] + Math.PI });
  }
  // Acoustic foam on the glass wall behind the booth + ON AIR light.
  for (const t of [0.1, 0.26]) {
    const p = rb.againstWall('n', t, 0.06);
    rb.out.props.push({ kind: 'foam', x: p.x, z: p.z, rot: FACE.s });
  }
  const air = rb.againstWall('n', 0.36, 0.06);
  rb.out.props.push({ kind: 'onAir', x: air.x, z: air.z, rot: FACE.s });
  rb.placeSolid('bookcaseOpen', x0 + wall + FURN.bookcaseOpen.d / 2 + 0.05, z1 - 3, FACE.e);
  rb.placeSolid('pottedPlant', x0 + 0.8, z0 + 0.8, 0);
  rb.placeSolid('pottedPlant', x0 + 0.8, z1 - 0.8, 1);
  rb.place('lampRoundFloor', px + 2.8, pz - 2.6, 0);

  // --- News set ----------------------------------------------------------------
  const nx = x1 - 7;
  // Video wall along the glass wall behind the anchors.
  addBoard(rb, 'n', (nx - 2.3 - x0) / rb.def.w, 4.4, 'broadcast');
  addBoard(rb, 'n', (nx + 2.3 - x0) / rb.def.w, 4.4, 'screen');
  const onAirTv = rb.againstWall('n', (nx - 5.2 - x0) / rb.def.w, 0.06);
  rb.out.props.push({ kind: 'onAir', x: onAirTv.x, z: onAirTv.z, rot: FACE.s });
  // Anchor desk facing the cameras (south), anchors sit behind it.
  const dz = z0 + 6;
  rb.out.props.push({ kind: 'newsDesk', x: nx, z: dz, rot: FACE.s });
  rb.obstacle(nx, dz, 4.4, 1.1);
  for (const dx of [-1, 1]) {
    const sx = nx + dx * 1.1;
    const sz = dz - 0.55 - 0.5;
    rb.place('chairDesk', sx, sz, FACE.s);
    rb.seat('desk', v2(sx, sz), FACE.s, v2(sx, sz - 0.5 - APPROACH_PAD));
  }
  rb.obstacle(nx, dz - 1.05, 3.4, 0.8);
  // Studio cameras with operators behind them.
  for (const dx of [-2.2, 2.2]) {
    const cz = z1 - 5;
    rb.out.props.push({ kind: 'cameraRig', x: nx + dx, z: cz, rot: FACE.n + dx * 0.08 });
    rb.obstacle(nx + dx, cz, 0.8, 0.8);
    rb.spot(v2(nx + dx, cz + 0.5 + APPROACH_PAD), FACE.n, true);
  }
  // Lights aimed at the desk.
  for (const dx of [-4.2, 4.2]) {
    rb.out.props.push({ kind: 'softbox', x: nx + dx, z: dz + 3.2, rot: FACE.n - dx * 0.12 });
    rb.obstacle(nx + dx, dz + 3.2, 0.8, 0.8);
  }
  // Control desk (producer) against the east glass wall, screens facing into the room.
  const cp = rb.againstWall('e', 0.8, 0.8);
  rb.out.tables.push({ x: cp.x, z: cp.z, w: 1.2, d: 2.6, h: 0.95 });
  rb.obstacle(cp.x, cp.z, 1.2, 2.6);
  for (const dzz of [-0.65, 0.65]) {
    rb.place('computerScreen', cp.x + 0.3, cp.z + dzz, FACE.w, 0.95);
    rb.out.extraScreens.push({ x: cp.x + 0.3, y: 0.95, z: cp.z + dzz, rot: FACE.w });
    rb.spot(v2(cp.x - 0.6 - APPROACH_PAD, cp.z + dzz), FACE.e, true);
  }
}

// ---------------------------------------------------------------------------
// Walls

type Interval = [number, number];

function subtractIntervals(walls: Interval[], gaps: Interval[]): Interval[] {
  const merged = mergeIntervals(walls);
  let result = merged;
  for (const [g0, g1] of gaps) {
    const next: Interval[] = [];
    for (const [a, b] of result) {
      if (g1 <= a || g0 >= b) {
        next.push([a, b]);
        continue;
      }
      if (g0 > a) next.push([a, g0]);
      if (g1 < b) next.push([g1, b]);
    }
    result = next;
  }
  return result.filter(([a, b]) => b - a > 0.05);
}

function mergeIntervals(list: Interval[]): Interval[] {
  const sorted = [...list].sort((p, q) => p[0] - q[0]);
  const out: Interval[] = [];
  for (const iv of sorted) {
    const last = out[out.length - 1];
    if (last && iv[0] <= last[1] + 1e-6) last[1] = Math.max(last[1], iv[1]);
    else out.push([iv[0], iv[1]]);
  }
  return out;
}

function buildWalls(out: OfficeLayout, rooms: RoomLayout[]) {
  const lines = new Map<string, { horizontal: boolean; c: number; walls: Interval[]; gaps: Interval[]; outer: boolean }>();
  const line = (horizontal: boolean, c: number) => {
    const key = `${horizontal ? 'h' : 'v'}:${c.toFixed(3)}`;
    let l = lines.get(key);
    if (!l) {
      l = { horizontal, c, walls: [], gaps: [], outer: false };
      lines.set(key, l);
    }
    return l;
  };
  const addRect = (x0: number, z0: number, x1: number, z1: number, outer = false) => {
    for (const l of [line(true, z0), line(true, z1)]) {
      l.walls.push([x0, x1]);
      l.outer ||= outer;
    }
    for (const l of [line(false, x0), line(false, x1)]) {
      l.walls.push([z0, z1]);
      l.outer ||= outer;
    }
  };

  addRect(BUILDING.x0, BUILDING.z0, BUILDING.x1, BUILDING.z1, true);
  line(true, BUILDING.z1).gaps.push([ENTRANCE.x - ENTRANCE.width / 2, ENTRANCE.x + ENTRANCE.width / 2]);
  // Side exits at both ends of the lower hallway spread out big departures.
  for (const x of [BUILDING.x0, BUILDING.x1]) line(false, x).gaps.push([SIDE_EXIT_Z - 2.5, SIDE_EXIT_Z + 2.5]);

  for (const r of rooms) {
    addRect(r.x0, r.z0, r.x1, r.z1);
    for (const d of r.doors) {
      const horizontal = d.side === 'n' || d.side === 's';
      const c = horizontal ? d.z : d.x;
      const along = horizontal ? d.x : d.z;
      line(horizontal, c).gaps.push([along - d.width / 2, along + d.width / 2]);
    }
  }

  const t = WALL_THICKNESS;
  for (const l of lines.values()) {
    for (const [a, b] of subtractIntervals(l.walls, l.gaps)) {
      const len = b - a + t;
      const mid = (a + b) / 2;
      const h = l.outer ? WALL_HEIGHT : GLASS_WALL_HEIGHT;
      const box: Wall = l.horizontal
        ? { x: mid, z: l.c, w: len, d: t, h, outer: l.outer }
        : { x: l.c, z: mid, w: t, d: len, h, outer: l.outer };
      out.walls.push(box);
      out.obstacles.push({ x: box.x, z: box.z, w: box.w, d: box.d, h: OBSTACLE_NAV_HEIGHT });
    }
  }
}

// ---------------------------------------------------------------------------

function resolveDoors(def: RoomDef): Door[] {
  return def.doors.map((d) => {
    const t = d.t ?? 0.5;
    const width = d.width ?? 3.6;
    const inset = 1.2;
    switch (d.side) {
      case 'n': {
        const x = def.x + def.w * t;
        return { x, z: def.z, side: d.side, width, inside: v2(x, def.z + inset) };
      }
      case 's': {
        const x = def.x + def.w * t;
        return { x, z: def.z + def.d, side: d.side, width, inside: v2(x, def.z + def.d - inset) };
      }
      case 'w': {
        const z = def.z + def.d * t;
        return { x: def.x, z, side: d.side, width, inside: v2(def.x + inset, z) };
      }
      case 'e': {
        const z = def.z + def.d * t;
        return { x: def.x + def.w, z, side: d.side, width, inside: v2(def.x + def.w - inset, z) };
      }
    }
  });
}

export function buildLayout(seed = 7): OfficeLayout {
  const rng = new Rng(seed);
  const out: OfficeLayout = {
    rooms: new Map(),
    walls: [],
    rugs: [],
    props: [],
    obstacles: [],
    placements: [],
    monitors: [],
    extraScreens: [],
    boards: [],
    racks: [],
    tables: [],
    trees: [],
    floors: [],
    bounds: { x0: PLAZA.x0, z0: BUILDING.z0 - 4, x1: PLAZA.x1, z1: PLAZA.z1 },
    entrance: {
      inside: v2(ENTRANCE.x, BUILDING.z1 - 2.5),
      outside: v2(ENTRANCE.x, BUILDING.z1 + 2.5),
    },
    street: { x0: PLAZA.x0 + 2, x1: PLAZA.x1 - 2, z0: PLAZA.streetZ - 1, z1: PLAZA.z1 - 1 },
    transport: { busWait: [], carWait: [], bikeSlots: [], shelter: { x: 0, z: 0, w: 0, d: 0, h: 0 } },
    alarms: [],
    guards: [],
    receptionists: [],
    serviceDoor: v2(BUILDING.x1 + 3, SIDE_EXIT_Z),
    robotDock: { x: BUILDING.x1 - 1.4, z: 12, yaw: FACE.w },
    landscape: { planters: [], lamps: [], fountain: null, bushes: [], indoorTrees: [] },
    turnstiles: null,
  };

  out.floors.push({ x0: PLAZA.x0, z0: PLAZA.z0, x1: PLAZA.x1, z1: PLAZA.z1, color: '#d6d2c8', y: 0, pattern: 'pavers' });
  out.floors.push({ ...BUILDING, color: HALLWAY_FLOOR, y: 0.005, pattern: 'concrete' });
  // Paths from the side exits down to the plaza.
  out.floors.push({ x0: PLAZA.x0, z0: SIDE_EXIT_Z - 3, x1: BUILDING.x0, z1: PLAZA.z0, color: '#d6d2c8', y: 0.004, pattern: 'pavers' });
  out.floors.push({ x0: BUILDING.x1, z0: SIDE_EXIT_Z - 3, x1: PLAZA.x1, z1: PLAZA.z0, color: '#d6d2c8', y: 0.004, pattern: 'pavers' });

  const roomLayouts: RoomLayout[] = [];
  for (const def of ROOMS) {
    const rb = new RoomBuilder(def, out, rng);
    switch (def.kind) {
      case 'work':
        buildWorkRoom(rb);
        break;
      case 'meeting':
        buildMeetingRoom(rb);
        break;
      case 'library':
        buildLibrary(rb);
        break;
      case 'server':
        buildServerRoom(rb);
        break;
      case 'lounge':
        buildLounge(rb);
        break;
      case 'lobby':
        buildLobby(rb);
        break;
      case 'studio':
        buildStudio(rb);
        break;
      case 'media':
        buildMediaStudio(rb);
        break;
    }
    const doors = resolveDoors(def);
    const first = doors[0];
    const room: RoomLayout = {
      def,
      x0: rb.x0,
      z0: rb.z0,
      x1: rb.x1,
      z1: rb.z1,
      doors,
      seats: rb.seats,
      spots: rb.spots,
      labelPos: first
        ? v2(first.inside.x + 3.2 * (first.side === 'n' || first.side === 's' ? 1 : 0), first.inside.z)
        : v2(def.x + def.w / 2, def.z + def.d / 2),
    };
    out.rooms.set(def.id, room);
    roomLayouts.push(room);
    const pattern: FloorPattern =
      def.kind === 'server'
        ? 'tiles'
        : def.kind === 'lounge' || def.kind === 'lobby'
          ? 'terrazzo'
          : def.kind === 'library'
            ? 'darkwood'
            : def.kind === 'studio'
              ? 'terrazzo'
              : def.kind === 'media'
                ? 'concrete'
                : 'wood';
    out.floors.push({ x0: rb.x0, z0: rb.z0, x1: rb.x1, z1: rb.z1, color: def.floor, y: 0.01, pattern });
  }

  buildWalls(out, roomLayouts);

  // Security: a guard on each side of every server-room door, facing the hallway.
  const server = roomLayouts.find((r) => r.def.kind === 'server');
  for (const d of server?.doors ?? []) {
    const out_ = d.side === 'n' ? -1 : d.side === 's' ? 1 : 0;
    for (const sgn of [-1, 1]) {
      const g = { x: d.x + sgn * (d.width / 2 + 0.55), z: d.z + out_ * 0.85, yaw: d.side === 'n' ? Math.PI : 0 };
      out.guards.push(g);
      out.obstacles.push({ x: g.x, z: g.z, w: 0.9, d: 0.9, h: OBSTACLE_NAV_HEIGHT });
    }
  }

  // Alarm beacons on the wall next to every room's first door + building corners.
  for (const r of roomLayouts) {
    const d = r.doors[0];
    if (!d) continue;
    const off = d.width / 2 + 0.6;
    const horizontal = d.side === 'n' || d.side === 's';
    out.alarms.push({ x: horizontal ? d.x + off : d.x, z: horizontal ? d.z : d.z + off, y: GLASS_WALL_HEIGHT });
  }
  for (const [x, z] of [
    [BUILDING.x0, BUILDING.z0],
    [BUILDING.x1, BUILDING.z0],
    [BUILDING.x0, BUILDING.z1],
    [BUILDING.x1, BUILDING.z1],
    [ENTRANCE.x - ENTRANCE.width / 2 - 0.6, BUILDING.z1],
    [ENTRANCE.x + ENTRANCE.width / 2 + 0.6, BUILDING.z1],
  ]) {
    out.alarms.push({ x, z, y: WALL_HEIGHT });
  }

  // Hallway plants at the corridor ends.
  const hallPlants: [number, number][] = [
    [BUILDING.x0 + 0.8, 21],
    [BUILDING.x1 - 0.8, 21],
    [BUILDING.x0 + 0.8, 40],
    [BUILDING.x1 - 0.8, 40],
    [BUILDING.x0 + 0.8, BUILDING.z0 + 0.8],
    [BUILDING.x1 - 0.8, BUILDING.z0 + 0.8],
    [BUILDING.x0 + 0.8, BUILDING.z1 - 0.8],
    [BUILDING.x1 - 0.8, BUILDING.z1 - 0.8],
  ];
  const inRoom = (x: number, z: number) => roomLayouts.some((r) => x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1);
  for (const [x, z] of hallPlants) {
    if (inRoom(x, z)) continue;
    out.placements.push({ model: 'pottedPlant', x, z, rot: rng.float(0, 6) });
    out.obstacles.push({ x, z, w: 0.7, d: 0.7, h: OBSTACLE_NAV_HEIGHT });
  }

  // Robot charging dock against the east wall: pillar is solid, the robot stands on the pad.
  const dock = out.robotDock;
  out.props.push({ kind: 'robotDock', x: dock.x, z: dock.z, rot: dock.yaw });
  out.obstacles.push({ x: BUILDING.x1 - 0.45, z: dock.z, w: 0.5, d: 1.0, h: OBSTACLE_NAV_HEIGHT });

  buildTransport(out);

  buildLandscape(out, rng);

  // Trees along the street.
  for (let x = PLAZA.x0 + 4; x < PLAZA.x1 - 2; x += 9) {
    if (Math.abs(x - ENTRANCE.x) < 6 || Math.abs(x - BUS_STOP_X) < 5 || Math.abs(x - HELIPAD.x) < 5) continue;
    const z = PLAZA.z0 + 5.5;
    out.trees.push({ x, z, s: rng.float(0.85, 1.2) });
    out.obstacles.push({ x, z, w: 1.0, d: 1.0, h: OBSTACLE_NAV_HEIGHT });
  }

  return out;
}

/**
 * Landscaping: flower planters along the front façade (leaving the entrance
 * free), street lamps along the curb, a fountain on the west plaza, hedges and
 * bushes around the building and a tree line behind it.
 */
function buildLandscape(out: OfficeLayout, rng: Rng) {
  const L = out.landscape;
  const solid = (x: number, z: number, w: number, d: number) => out.obstacles.push({ x, z, w, d, h: OBSTACLE_NAV_HEIGHT });

  // Planters along the south façade, skipping the entrance and the helipad walk.
  const pz = BUILDING.z1 + 1.1;
  for (let x = BUILDING.x0 + 3; x < BUILDING.x1 - 2; x += 7) {
    if (Math.abs(x - ENTRANCE.x) < ENTRANCE.width / 2 + 3) continue;
    const p = { x, z: pz, w: 4.2, d: 0.9, h: 0.55 };
    L.planters.push(p);
    solid(p.x, p.z, p.w, p.d);
  }

  // Street lamps along the curb.
  // Keep clear of car doors (slot centres) and the bus bays where people get in and out.
  for (let x = PLAZA.x0 + 6; x < PLAZA.x1 - 1; x += 12) {
    if (BUS_BAYS.some((b) => Math.abs(x - b) < 6.5) || CAR_SLOTS.some((c) => Math.abs(x - c) < 1.5)) continue;
    const pos = v2(x, ROAD.curbZ - 0.7);
    L.lamps.push(pos);
    solid(pos.x, pos.z, 0.4, 0.4);
  }

  // Tall indoor trees in the hallways, against the walls between room doors (never mid-corridor).
  for (const [x, z] of [
    [22, 18.9],
    [66, 18.9],
    [44, 23.1],
    [80.8, 23.1],
    [22, 42.9],
    [66, 42.9],
    [44, 47.1],
    [74, 47.1],
  ]) {
    L.indoorTrees.push({ x, z, s: rng.float(1.3, 1.5) });
    solid(x, z, 1.0, 1.0);
  }

  // Fountain on the west plaza.
  L.fountain = { x: BUILDING.x0 + 10, z: PLAZA.z0 + 6.5, r: 2.4 };
  solid(L.fountain.x, L.fountain.z, L.fountain.r * 2, L.fountain.r * 2);

  // Hedge-like bushes hugging the building outside (not in front of the side exits).
  const bush = (x: number, z: number, s: number) => L.bushes.push({ x, z, s });
  for (let x = BUILDING.x0; x <= BUILDING.x1; x += 1.6) bush(x + rng.float(-0.3, 0.3), BUILDING.z0 - 1.3 + rng.float(-0.2, 0.2), rng.float(0.8, 1.2));
  for (const x of [BUILDING.x0 - 1.3, BUILDING.x1 + 1.3]) {
    for (let z = BUILDING.z0 + 1; z <= SIDE_EXIT_Z - 5; z += 1.6) bush(x + rng.float(-0.2, 0.2), z, rng.float(0.8, 1.15));
  }
  // Tree line behind the building (purely decorative, outside the walkable area).
  for (let x = BUILDING.x0 - 6; x <= BUILDING.x1 + 8; x += rng.float(6, 9)) {
    out.trees.push({ x, z: BUILDING.z0 - 6 - rng.float(0, 4), s: rng.float(0.9, 1.35) });
  }
}

/** Bus stop, curb pick-up spots, bike rack and helipad on the plaza. */
function buildTransport(out: OfficeLayout) {
  const t = out.transport;
  const spot = (id: string, x: number, z: number, yaw: number): Spot => ({ id, roomId: 'plaza', pos: v2(x, z), yaw, interact: false, occupant: null });
  const waitZ = ROAD.curbZ - 1.6;

  // Bus shelter set back from the curb, people wait in front of it.
  t.shelter = { x: BUS_STOP_X, z: ROAD.curbZ - 4.6, w: 6, d: 1.4, h: 2.4 };
  out.obstacles.push({ ...t.shelter, h: OBSTACLE_NAV_HEIGHT });
  let i = 0;
  for (const dz of [0, -1.2]) {
    for (let dx = -3; dx <= 3; dx += 1.2) t.busWait.push(spot(`bus${i++}`, BUS_STOP_X + dx, waitZ + dz, 0));
  }

  CAR_SLOTS.forEach((x, k) => t.carWait.push(spot(`car${k}`, x, waitZ, 0)));

  for (let k = 0; k < BIKE_RACK.slots; k++) {
    const x = BIKE_RACK.x0 + k * BIKE_RACK.spacing;
    t.bikeSlots.push({ pos: v2(x, BIKE_RACK.z + 0.8), approach: v2(x, BIKE_RACK.z + 2.6), occupant: null });
  }
  const rackW = BIKE_RACK.slots * BIKE_RACK.spacing;
  out.obstacles.push({ x: BIKE_RACK.x0 + rackW / 2 - BIKE_RACK.spacing / 2, z: BIKE_RACK.z + 0.6, w: rackW + 0.4, d: 1.9, h: OBSTACLE_NAV_HEIGHT });

  // The helipad is walkable: it sits right in front of the entrance and blocking it jams crowds.
}
