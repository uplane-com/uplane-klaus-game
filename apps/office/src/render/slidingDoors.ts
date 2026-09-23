import * as THREE from 'three';
import { GLASS_WALL_HEIGHT } from '../config/scale';
import type { Door } from '../world/layout';

/**
 * Automatic sliding glass doors: two panels glide apart when someone comes
 * close and close again once the doorway is clear.
 */
export class SlidingDoors {
  readonly group = new THREE.Group();
  private readonly doors: { door: Door; left: THREE.Object3D; right: THREE.Object3D; open: number }[] = [];

  constructor(doors: Door[]) {
    const glass = new THREE.MeshStandardMaterial({ color: '#bfe0ff', transparent: true, opacity: 0.4, roughness: 0.05, metalness: 0.2, depthWrite: false });
    const frame = new THREE.MeshStandardMaterial({ color: '#b7bfcc', roughness: 0.4, metalness: 0.5 });
    const sensor = new THREE.MeshBasicMaterial({ color: '#4fc3ff', toneMapped: false });

    for (const door of doors) {
      const horizontal = door.side === 'n' || door.side === 's';
      const root = new THREE.Group();
      root.position.set(door.x, 0, door.z);
      if (!horizontal) root.rotation.y = Math.PI / 2;
      const w = door.width / 2;
      const h = GLASS_WALL_HEIGHT - 0.1;

      const panel = () => {
        const g = new THREE.Group();
        const pane = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.04), glass);
        pane.position.y = h / 2;
        const edge = new THREE.Mesh(new THREE.BoxGeometry(w, 0.05, 0.07), frame);
        edge.position.y = 0.03;
        const handle = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.5, 0.08), frame);
        handle.position.set(0, h * 0.5, 0);
        g.add(pane, edge, handle);
        root.add(g);
        return g;
      };
      const left = panel();
      const right = panel();
      // Header box with a little sensor light on top of the opening.
      const header = new THREE.Mesh(new THREE.BoxGeometry(door.width + 0.4, 0.14, 0.2), frame);
      header.position.y = GLASS_WALL_HEIGHT - 0.02;
      const eye = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.04, 0.22), sensor);
      eye.position.y = GLASS_WALL_HEIGHT - 0.1;
      root.add(header, eye);
      this.group.add(root);
      this.doors.push({ door, left, right, open: 0 });
    }
  }

  /** `people` are world positions of everyone who should trigger the sensors. */
  update(dt: number, people: Iterable<{ x: number; z: number }>) {
    const near = this.doors.map(() => false);
    for (const p of people) {
      this.doors.forEach((d, i) => {
        if (near[i]) return;
        const horizontal = d.door.side === 'n' || d.door.side === 's';
        const along = horizontal ? p.x - d.door.x : p.z - d.door.z;
        const across = horizontal ? p.z - d.door.z : p.x - d.door.x;
        if (Math.abs(along) < d.door.width / 2 + 0.6 && Math.abs(across) < 2.4) near[i] = true;
      });
    }
    this.doors.forEach((d, i) => {
      // Open fast, close a bit slower.
      d.open += ((near[i] ? 1 : 0) - d.open) * (1 - Math.exp(-(near[i] ? 8 : 3) * dt));
      const w = d.door.width / 2;
      const closed = w / 2;
      const offset = closed + d.open * (w - 0.1);
      d.left.position.x = -offset;
      d.right.position.x = offset;
    });
  }
}
