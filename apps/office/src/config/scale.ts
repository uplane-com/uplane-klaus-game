/**
 * World scale. Kenney models are authored in small units; we scale furniture
 * and characters separately so the chibi characters fit the desks nicely.
 */
export const FURNITURE_SCALE = 2.6;
export const CHARACTER_SCALE = 2.6;

export const AGENT_RADIUS = 0.5;
export const AGENT_HEIGHT = 1.6;

/** Outer (cut-away) building walls. */
export const WALL_HEIGHT = 1.25;
/** Interior glass partitions. */
export const GLASS_WALL_HEIGHT = 1.9;
export const WALL_THICKNESS = 0.3;
/** Height used for obstacles in the navmesh input (must be < AGENT_HEIGHT). */
export const OBSTACLE_NAV_HEIGHT = 1.0;

/** Raw Kenney bounds (width x, height y, depth z) measured from the GLBs. */
const RAW = {
  desk: [0.73, 0.38, 0.39],
  chairDesk: [0.33, 0.61, 0.31],
  computerScreen: [0.39, 0.29, 0.1],
  computerKeyboard: [0.28, 0.03, 0.12],
  pottedPlant: [0.21, 0.65, 0.24],
  plantSmall1: [0.09, 0.14, 0.09],
  plantSmall2: [0.09, 0.14, 0.09],
  plantSmall3: [0.09, 0.14, 0.09],
  bookcaseOpen: [0.4, 0.88, 0.25],
  bookcaseClosedWide: [0.8, 0.79, 0.25],
  kitchenCoffeeMachine: [0.19, 0.18, 0.24],
  kitchenBar: [0.43, 0.42, 0.21],
  kitchenFridge: [0.43, 0.92, 0.29],
  kitchenCabinet: [0.43, 0.45, 0.45],
  kitchenSink: [0.43, 0.49, 0.45],
  kitchenMicrowave: [0.29, 0.18, 0.23],
  loungeSofa: [0.98, 0.46, 0.41],
  loungeChair: [0.49, 0.46, 0.41],
  loungeDesignSofa: [1.12, 0.4, 0.41],
  tableCoffee: [0.66, 0.23, 0.4],
  table: [0.84, 0.33, 0.45],
  chairCushion: [0.2, 0.46, 0.2],
  rugRectangle: [1.57, 0.01, 0.92],
  rugRound: [0.92, 0.01, 0.92],
  trashcan: [0.21, 0.43, 0.23],
  lampRoundFloor: [0.15, 0.86, 0.18],
  televisionModern: [0.68, 0.45, 0.13],
  stoolBar: [0.27, 0.43, 0.23],
  books: [0.15, 0.1, 0.09],
  laptop: [0.26, 0.16, 0.24],
  cardboardBoxClosed: [0.21, 0.28, 0.21],
  coatRackStanding: [0.27, 0.77, 0.27],
  speaker: [0.15, 0.64, 0.15],
} as const;

export type FurnitureModel = keyof typeof RAW;
export const FURNITURE_MODELS = Object.keys(RAW) as FurnitureModel[];

export interface Dims {
  w: number;
  h: number;
  d: number;
}

export const FURN: Record<FurnitureModel, Dims> = Object.fromEntries(
  Object.entries(RAW).map(([k, [w, h, d]]) => [
    k,
    { w: w * FURNITURE_SCALE, h: h * FURNITURE_SCALE, d: d * FURNITURE_SCALE },
  ]),
) as Record<FurnitureModel, Dims>;
