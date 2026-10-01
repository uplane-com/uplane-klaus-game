import * as THREE from 'three';
import { BOOTH, type Booth } from '../world/layout';

const FREE = new THREE.Color('#38e07b');
const BUSY = new THREE.Color('#ff4d4f');

/**
 * Acoustic phone booths: felt back wall, felt-and-glass sides, a framed glass
 * front, a bench inside, a warm ceiling glow and a status light on top that
 * turns red while someone has the booth.
 */
export class Booths {
  readonly group = new THREE.Group();
  private readonly lights: THREE.MeshBasicMaterial[] = [];

  constructor(private readonly booths: Booth[]) {
    const { w, d, h } = BOOTH;
    const box = (sx: number, sy: number, sz: number) => new THREE.BoxGeometry(sx, sy, sz);
    const frame = new THREE.MeshStandardMaterial({ color: '#23262d', roughness: 0.45, metalness: 0.4 });
    const glass = new THREE.MeshStandardMaterial({ color: '#d7e8ff', transparent: true, opacity: 0.25, roughness: 0.05, metalness: 0.2, depthWrite: false });
    const oak = new THREE.MeshStandardMaterial({ color: '#c89f73', roughness: 0.7 });
    const glow = new THREE.MeshBasicMaterial({ color: '#fff0d2', toneMapped: false });
    const felts = new Map<string, THREE.MeshStandardMaterial>();
    const felt = (c: string) => {
      let m = felts.get(c);
      if (!m) felts.set(c, (m = new THREE.MeshStandardMaterial({ color: c, roughness: 1 })));
      return m;
    };
    const t = 0.08;
    const lowH = 1.0;

    for (const b of booths) {
      const g = new THREE.Group();
      g.position.set(b.x, 0, b.z);
      // Local +z is the glass front.
      g.rotation.y = b.yaw;
      const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, shadow = true) => {
        const m = new THREE.Mesh(geo, mat);
        m.position.set(x, y, z);
        m.castShadow = m.receiveShadow = shadow;
        g.add(m);
        return m;
      };
      const fm = felt(b.color);
      add(box(w, 0.08, d), frame, 0, 0.04, 0);
      // Back wall in felt, open top with a felt rim so the caller stays visible from above.
      add(box(w, h, t), fm, 0, h / 2, -d / 2 + t / 2);
      add(box(w, 0.16, 0.1), fm, 0, h - 0.08, d / 2 - 0.05);
      for (const sx of [-1, 1]) add(box(0.1, 0.16, d), fm, sx * (w / 2 - 0.05), h - 0.08, 0);
      // Sides: felt below, glass above.
      for (const sx of [-1, 1]) {
        add(box(t, lowH, d - t), fm, sx * (w / 2 - t / 2), lowH / 2, t / 2);
        add(box(0.04, h - lowH - 0.16, d - t), glass, sx * (w / 2 - t / 2), lowH + (h - lowH - 0.16) / 2, t / 2, false).renderOrder = 3;
      }
      // Glass front with a black frame and a brass handle.
      add(box(w - 2 * t, h - 0.24, 0.04), glass, 0, (h - 0.24) / 2 + 0.08, d / 2 - 0.02, false).renderOrder = 3;
      for (const sx of [-1, 1]) add(box(0.06, h - 0.16, 0.06), frame, sx * (w / 2 - 0.03), (h - 0.16) / 2, d / 2 - 0.03);
      add(box(0.03, 0.4, 0.05), new THREE.MeshStandardMaterial({ color: '#c9a45c', roughness: 0.3, metalness: 0.8 }), w / 2 - 0.22, 1.05, d / 2 + 0.03);
      // Bench + small shelf.
      add(box(w - 2 * t - 0.1, 0.42, 0.5), fm, 0, 0.21, -d / 2 + t + 0.25);
      add(box(w - 2 * t - 0.1, 0.06, 0.5), oak, 0, 0.45, -d / 2 + t + 0.25);
      add(box(0.5, 0.04, 0.3), oak, w / 2 - t - 0.3, 0.95, -d / 2 + t + 0.15);
      // Warm strip light along the top of the back wall, and the status light.
      add(box(w - 0.3, 0.05, 0.05), glow, 0, h - 0.2, -d / 2 + t + 0.03, false);
      const light = new THREE.MeshBasicMaterial({ color: FREE, toneMapped: false });
      this.lights.push(light);
      add(new THREE.SphereGeometry(0.06, 10, 8), light, 0, h + 0.02, d / 2 - 0.1, false);
      this.group.add(g);
    }
  }

  /** Status lights follow the booth reservations. */
  update() {
    this.booths.forEach((b, i) => this.lights[i].color.copy(b.seat.occupant ? BUSY : FREE));
  }
}
