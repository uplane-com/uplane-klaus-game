import { PLAZA } from './office';

/**
 * Street + arrival infrastructure in front of the building. Vehicles drive
 * eastbound (+x) in the curb lane and stop at the curb to drop people off.
 */
export const ROAD = {
  /** Plaza edge / curb line. */
  curbZ: PLAZA.z1,
  /** Bike strip right next to the curb. */
  bikeZ: PLAZA.z1 + 0.55,
  /** Curb (eastbound) lane centre. */
  laneZ: PLAZA.z1 + 4.2,
  /** Opposite (westbound) lane, used for ambient traffic. */
  oppositeLaneZ: PLAZA.z1 + 7.6,
  /** Where a stopped vehicle's centre sits (pulled in to the curb). */
  stopZ: PLAZA.z1 + 1.5,
  /** Where passengers step out onto the plaza. */
  alightZ: PLAZA.z1 - 0.5,
  spawnX: -70,
  despawnX: 180,
};

export const VEHICLE_SCALE = 1.5;

export const BUS_STOP_X = 12;
/** Bus bays along the curb; extra buses use the western bays at rush hour. */
export const BUS_BAYS = [BUS_STOP_X, BUS_STOP_X - 12, BUS_STOP_X - 24];
/** Curb drop-off slots for cars (x centres). */
export const CAR_SLOTS = [22, 28, 40, 46, 52, 58, 64, 70];

export const BIKE_RACK = { x0: 47.5, z: 73.4, slots: 8, spacing: 0.95 };
/** Right next to the entrance so helicopter guests have a short walk. */
export const HELIPAD = { x: 22.5, z: 71.2, r: 3.2 };

export type TransportMode = 'car' | 'bus' | 'bike' | 'scooter' | 'heli';

/** Relative likelihood of each arrival mode (bus/heli are adjusted by demand). */
export const ARRIVAL_WEIGHTS: Record<TransportMode, number> = {
  car: 0.42,
  bus: 0.26,
  bike: 0.14,
  scooter: 0.14,
  heli: 0.035,
};
