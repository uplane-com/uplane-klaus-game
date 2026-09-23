export interface Vec2 {
  x: number;
  z: number;
}

export const v2 = (x: number, z: number): Vec2 => ({ x, z });

export function dist2(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

/** Yaw (rotation around Y) that makes a +Z-facing model look along (dx, dz). */
export function yawTowards(dx: number, dz: number): number {
  return Math.atan2(dx, dz);
}

export function dampAngle(current: number, target: number, lambda: number, dt: number): number {
  let delta = target - current;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return current + delta * (1 - Math.exp(-lambda * dt));
}

export function damp(current: number, target: number, lambda: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-lambda * dt));
}

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
