import * as THREE from 'three';
import type { OfficeLayout } from '../world/layout';

/**
 * Lobby security gates: steel cabinets with card readers, glass flaps that
 * swing open after a badge scan, and a status light per lane.
 */
export class Turnstiles {
  readonly group = new THREE.Group();
  private readonly flaps: { left: THREE.Object3D; right: THREE.Object3D }[] = [];
  private readonly lights: THREE.MeshBasicMaterial[] = [];
  private readonly open: number[] = [];
  private readonly green = new THREE.Color('#2fe07b');
  private readonly idle = new THREE.Color('#e5383b');

  constructor(private readonly gates: NonNullable<OfficeLayout['turnstiles']>) {
    const z = gates.z;
    const steel = new THREE.MeshStandardMaterial({ color: '#d9dde3', metalness: 0.15, roughness: 0.35 });
    const top = new THREE.MeshStandardMaterial({ color: '#1f242c', roughness: 0.2, metalness: 0.4 });
    const glass = new THREE.MeshStandardMaterial({ color: '#cfe6ff', transparent: true, opacity: 0.35, roughness: 0.05, depthWrite: false });
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, zz: number, parent: THREE.Object3D = this.group) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, zz);
      m.castShadow = true;
      parent.add(m);
      return m;
    };

    for (const cx of gates.cabinets) {
      add(new THREE.BoxGeometry(0.28, 1.0, 1.2), steel, cx, 0.5, z);
      add(new THREE.BoxGeometry(0.3, 0.04, 1.22), top, cx, 1.02, z);
    }
    // Glass barrier panels from the outer cabinets to the lobby walls.
    for (const b of gates.barriers) {
      add(new THREE.BoxGeometry(b.w, 1.05, 0.05), glass, b.x, 0.55, b.z);
      add(new THREE.BoxGeometry(b.w, 0.05, 0.08), steel, b.x, 1.1, b.z);
    }

    const flapGeo = new THREE.BoxGeometry(0.72, 0.7, 0.03);
    flapGeo.translate(0.36, 0, 0); // hinge at the cabinet
    const readerGeo = new THREE.BoxGeometry(0.16, 0.05, 0.16);
    gates.lanes.forEach((_, i) => {
      const left = new THREE.Group();
      left.position.set(gates.cabinets[i] + 0.14, 0.72, z);
      add(flapGeo, glass, 0, 0, 0, left);
      const right = new THREE.Group();
      right.position.set(gates.cabinets[i + 1] - 0.14, 0.72, z);
      right.rotation.y = Math.PI;
      add(flapGeo, glass, 0, 0, 0, right);
      this.group.add(left, right);
      this.flaps.push({ left, right });
      this.open.push(0);

      // Card readers on both faces + a status light.
      const light = new THREE.MeshBasicMaterial({ color: this.idle.clone(), toneMapped: false });
      this.lights.push(light);
      for (const dz of [-0.45, 0.45]) add(readerGeo, top, gates.cabinets[i] + 0.02, 1.06, z + dz);
      add(new THREE.BoxGeometry(0.1, 0.03, 0.1), light, gates.cabinets[i] + 0.02, 1.09, z);
    });
  }

  /** Nearest lane to a point, or -1 if the point isn't at the gates. */
  laneAt(x: number, z: number, reach = 1.1): number {
    if (Math.abs(z - this.gates.z) > reach) return -1;
    let best = -1;
    let bestD = 0.8;
    this.gates.lanes.forEach((lx, i) => {
      const d = Math.abs(x - lx);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  }

  get z() {
    return this.gates.z;
  }

  /** Badge accepted: open the lane for a moment. */
  scan(lane: number) {
    this.open[lane] = 1.8;
  }

  update(dt: number) {
    this.flaps.forEach((f, i) => {
      this.open[i] = Math.max(0, this.open[i] - dt);
      const target = this.open[i] > 0.15 ? Math.PI / 2 : 0;
      f.left.rotation.y += (target - f.left.rotation.y) * (1 - Math.exp(-10 * dt));
      f.right.rotation.y += (Math.PI - target - f.right.rotation.y) * (1 - Math.exp(-10 * dt));
      this.lights[i].color.copy(this.open[i] > 0 ? this.green : this.idle);
    });
  }
}
