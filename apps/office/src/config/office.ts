import type { DeptId } from '@office/events';

/**
 * Office floor plan. Coordinates are world units (x = east, z = south).
 * Everything that is not inside a room is hallway. Room contents are
 * generated from `kind`, so adding a room is a config change only.
 */

export type RoomKind = 'work' | 'meeting' | 'library' | 'server' | 'lounge' | 'lobby' | 'studio' | 'media' | 'linear';
export type Side = 'n' | 's' | 'e' | 'w';

export interface DoorDef {
  side: Side;
  /** 0..1 position along the side (west→east / north→south). */
  t?: number;
  width?: number;
}

/**
 * Work rooms are split into four cells (NW, NE, SW, SE) around a central aisle;
 * each cell gets its own furniture setup so no two rooms look the same.
 * Sofa, nook and beanbag cells are laptop-on-lap workstations.
 */
export type WorkCell = 'pod' | 'pod2' | 'nook' | 'beanbags' | 'bench' | 'cafe' | 'rows' | 'sofaPair' | 'booths';

export interface RoomDef {
  id: string;
  name: string;
  kind: RoomKind;
  dept?: DeptId;
  x: number;
  z: number;
  w: number;
  d: number;
  doors: DoorDef[];
  floor: string;
  /** Work rooms: cell setups [NW, NE, SW, SE]. */
  cells?: [WorkCell, WorkCell, WorkCell, WorkCell];
  /** Floor finish override (work rooms default to wood). */
  pattern?: 'wood' | 'darkwood' | 'concrete' | 'terrazzo';
}

export const BUILDING = { x0: -32, z0: 0, x1: 102, z1: 64 };
export const PLAZA = { x0: -40, z0: 64, x1: 110, z1: 80, streetZ: 76 };
export const ENTRANCE = { x: 33, width: 12 };
export const HALLWAY_FLOOR = '#d4d7dc';

const R1 = 0;
const R2 = 24;
const R3 = 48;

export const ROOMS: RoomDef[] = [
  // Row 1 — Ad Studio + shared
  { id: 'creative', name: 'Creative', kind: 'work', dept: 'ad', x: 0, z: R1, w: 22, d: 18, doors: [{ side: 's' }], floor: '#f4e2cf', cells: ['pod', 'nook', 'beanbags', 'pod'] },
  { id: 'content', name: 'Content', kind: 'work', dept: 'ad', x: 22, z: R1, w: 22, d: 18, doors: [{ side: 's' }], floor: '#f6e8d6', cells: ['bench', 'pod', 'nook', 'bench'], pattern: 'terrazzo' },
  { id: 'adqa', name: 'Ad QA', kind: 'work', dept: 'ad', x: 44, z: R1, w: 22, d: 18, doors: [{ side: 's' }], floor: '#f4dcd0', cells: ['pod', 'pod', 'cafe', 'beanbags'] },
  { id: 'meeting-a', name: 'Meeting A', kind: 'meeting', x: 66, z: R1, w: 14, d: 18, doors: [{ side: 's' }], floor: '#e7e0f1' },
  { id: 'library', name: 'Library', kind: 'library', x: 80, z: R1, w: 16, d: 18, doors: [{ side: 's' }], floor: '#eadcc4' },

  // Row 2 — Engineering + server room
  { id: 'codegen', name: 'Code Gen', kind: 'work', dept: 'eng', x: 0, z: R2, w: 22, d: 18, doors: [{ side: 'n' }, { side: 's' }], floor: '#dbe6f4', cells: ['pod', 'nook', 'pod', 'beanbags'], pattern: 'darkwood' },
  { id: 'codereview', name: 'Code Review', kind: 'work', dept: 'eng', x: 22, z: R2, w: 22, d: 18, doors: [{ side: 'n' }, { side: 's' }], floor: '#dfe8f1', cells: ['rows', 'rows', 'nook', 'cafe'] },
  { id: 'testing', name: 'Testing', kind: 'work', dept: 'eng', x: 44, z: R2, w: 22, d: 18, doors: [{ side: 'n' }, { side: 's' }], floor: '#d9e3ee', cells: ['pod', 'bench', 'beanbags', 'pod'], pattern: 'concrete' },
  { id: 'prreview', name: 'PR Review', kind: 'work', dept: 'eng', x: 66, z: R2, w: 14, d: 18, doors: [{ side: 'n' }, { side: 's' }], floor: '#dde3f3', cells: ['pod2', 'sofaPair', 'sofaPair', 'pod2'] },
  { id: 'server', name: 'Server Room', kind: 'server', x: 80, z: R2, w: 16, d: 18, doors: [{ side: 'n' }, { side: 's' }], floor: '#3b4252' },

  // Row 3 — Comms, lobby, lounge, big meeting room
  { id: 'comms', name: 'Comms', kind: 'work', dept: 'comms', x: 0, z: R3, w: 22, d: 16, doors: [{ side: 'n' }], floor: '#dcefe3', cells: ['cafe', 'nook', 'bench', 'booths'], pattern: 'terrazzo' },
  { id: 'lobby', name: 'Lobby', kind: 'lobby', x: 22, z: R3, w: 22, d: 16, doors: [{ side: 'n', t: 0.3, width: 4 }, { side: 'n', t: 0.72, width: 4 }], floor: '#ebe7df' },
  { id: 'lounge', name: 'Coffee Lounge', kind: 'lounge', x: 44, z: R3, w: 30, d: 16, doors: [{ side: 'n', t: 0.3 }, { side: 'n', t: 0.72 }], floor: '#f0e5cc' },
  { id: 'linear', name: 'Linear', kind: 'linear', x: 74, z: R3, w: 10, d: 16, doors: [{ side: 'n', t: 0.2, width: 3 }], floor: '#ecebfa' },
  { id: 'meeting-b', name: 'Meeting B', kind: 'meeting', x: 84, z: R3, w: 12, d: 16, doors: [{ side: 'n' }], floor: '#e4e0f0' },

  // West wing, next to the Ad Studio — creative loft (spans rows 1–2) + workshop room
  {
    id: 'studio',
    name: 'Creative Studio',
    kind: 'studio',
    dept: 'ad',
    x: -32,
    z: R1,
    w: 26,
    d: 42,
    doors: [{ side: 'e', t: 0.3 }, { side: 'e', t: 0.75 }, { side: 's', t: 0.5, width: 4.4 }],
    floor: '#f7eef1',
  },
  { id: 'media', name: 'TV & Podcast', kind: 'media', dept: 'ad', x: -32, z: R3, w: 26, d: 16, doors: [{ side: 'n', t: 0.5 }], floor: '#4a4e5a' },
];
