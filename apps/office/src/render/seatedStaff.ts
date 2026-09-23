import type * as THREE from 'three';
import type { Character } from './characters';

/** Seat height/back offset for a desk chair (matches Body's SEAT_Y / SEAT_BACK). */
const SEAT_Y = 0.52;
const SEAT_BACK = 0.08;

/**
 * Staff who are always at their desk (not agents): the receptionists at the
 * front desk and the operator in the server room. They type, glance around
 * and wave now and then.
 */
export class SeatedStaff {
  private readonly staff: { c: Character; yaw: number; phase: number; wave: number }[] = [];

  constructor(scene: THREE.Scene, make: (index: number) => Character, seats: { x: number; z: number; yaw: number }[]) {
    seats.forEach((s, i) => {
      const c = make(i);
      c.root.position.set(s.x - Math.sin(s.yaw) * SEAT_BACK, SEAT_Y, s.z - Math.cos(s.yaw) * SEAT_BACK);
      c.root.rotation.y = s.yaw;
      c.play('sit', 0);
      c.setOpacity(1);
      scene.add(c.root);
      this.staff.push({ c, yaw: s.yaw, phase: i * 3.1, wave: 0 });
    });
  }

  update(dt: number, time: number, incident: boolean) {
    for (const s of this.staff) {
      const t = time + s.phase;
      // Alternate between typing and glancing at the entrance / colleague.
      const typing = !incident && Math.sin(t * 0.21) > -0.2;
      const look = typing ? 0 : Math.sin(t * 0.5) * 0.5;
      s.c.root.rotation.y += (s.yaw + look - s.c.root.rotation.y) * (1 - Math.exp(-3 * dt));
      if (s.wave <= 0 && !typing && Math.sin(t * 0.13) > 0.97) s.wave = 1.6;
      s.wave = Math.max(0, s.wave - dt);
      s.c.update(dt, { seated: true, typing, handUp: s.wave > 0, thinking: incident }, time);
    }
  }
}
