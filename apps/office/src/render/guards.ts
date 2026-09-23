import * as THREE from 'three';
import type { Character, CharacterLibrary } from './characters';

/** Security guards posted outside the server room: stand, look around, react to incidents. */
export class Guards {
  private readonly chars: { c: Character; yaw: number; phase: number }[] = [];

  constructor(scene: THREE.Scene, lib: CharacterLibrary, posts: { x: number; z: number; yaw: number }[]) {
    posts.forEach((p, i) => {
      const c = lib.createGuard(`guard-${i}`);
      c.root.position.set(p.x, 0, p.z);
      c.root.rotation.y = p.yaw;
      c.setOpacity(1);
      scene.add(c.root);
      this.chars.push({ c, yaw: p.yaw, phase: i * 1.7 });
    });
  }

  update(dt: number, time: number, incident: boolean) {
    for (const g of this.chars) {
      // Scan the hallway slowly; during an incident, turn to watch the room and stay alert.
      const look = incident ? Math.PI : Math.sin(time * 0.35 + g.phase) * 0.6;
      g.c.root.rotation.y += (g.yaw + look - g.c.root.rotation.y) * (1 - Math.exp(-2 * dt));
      g.c.update(dt, { handUp: incident && Math.sin(time * 0.8 + g.phase) > 0.6 }, time);
    }
  }
}
