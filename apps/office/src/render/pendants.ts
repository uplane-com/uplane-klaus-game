import * as THREE from 'three';
import type { Pendant } from '../world/layout';

/** Top of the cables (out of the frame for the usual camera angles). */
const CABLE_TOP = 7;

/**
 * Pendant lamps over tables, pods and sofas: black/brass domes, opal globes and
 * coloured cones on thin cables, each with a warm light pool on the floor that
 * grows stronger at night. Everything is instanced (a handful of draw calls).
 */
export class Pendants {
  readonly group = new THREE.Group();
  private readonly pools: THREE.MeshBasicMaterial;
  private readonly glow: THREE.MeshBasicMaterial;

  constructor(pendants: Pendant[], poolTexture: THREE.Texture) {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    const s = new THREE.Vector3();
    const color = new THREE.Color();
    const inst = (geo: THREE.BufferGeometry, mat: THREE.Material, list: Pendant[], place: (p: Pendant) => [number, number, number, number?], tint = false) => {
      const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
      list.forEach((p, i) => {
        const [x, y, z, sy = 1] = place(p);
        m.compose(v.set(x, y, z), q, s.set(1, sy, 1));
        mesh.setMatrixAt(i, m);
        if (tint) mesh.setColorAt(i, color.set(p.color));
      });
      mesh.count = list.length;
      this.group.add(mesh);
      return mesh;
    };

    const black = new THREE.MeshStandardMaterial({ color: '#1b1d22', roughness: 0.5, metalness: 0.4 });
    const brass = new THREE.MeshStandardMaterial({ color: '#c9a45c', roughness: 0.3, metalness: 0.8 });
    const shadeMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.45, metalness: 0.2, side: THREE.DoubleSide });
    this.glow = new THREE.MeshBasicMaterial({ color: '#fff0d2', toneMapped: false });

    // Cables from the shade up out of view.
    const cable = new THREE.CylinderGeometry(0.012, 0.012, 1, 4).translate(0, 0.5, 0);
    inst(cable, black, pendants, (p) => [p.x, p.y + 0.3, p.z, CABLE_TOP - p.y - 0.3]);

    const domes = pendants.filter((p) => p.kind === 'dome');
    const globes = pendants.filter((p) => p.kind === 'globe');
    const cones = pendants.filter((p) => p.kind === 'cone');

    // Dome: wide shallow metal shade with a brass rim and a bright disc underneath.
    inst(new THREE.SphereGeometry(0.42, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.7, 1), shadeMat, domes, (p) => [p.x, p.y, p.z], true);
    inst(new THREE.TorusGeometry(0.42, 0.018, 4, 24).rotateX(Math.PI / 2), brass, domes, (p) => [p.x, p.y, p.z]);
    inst(new THREE.CircleGeometry(0.36, 18).rotateX(Math.PI / 2), this.glow, domes, (p) => [p.x, p.y + 0.02, p.z]);

    // Globe: glowing opal sphere with a brass cap.
    inst(new THREE.SphereGeometry(0.26, 16, 12), this.glow, globes, (p) => [p.x, p.y + 0.2, p.z]);
    inst(new THREE.CylinderGeometry(0.06, 0.08, 0.1, 10), brass, globes, (p) => [p.x, p.y + 0.48, p.z]);

    // Cone: coloured open cone with a bulb peeking out.
    inst(new THREE.ConeGeometry(0.3, 0.42, 18, 1, true).translate(0, 0.21, 0), shadeMat, cones, (p) => [p.x, p.y, p.z], true);
    inst(new THREE.SphereGeometry(0.1, 10, 8), this.glow, cones, (p) => [p.x, p.y + 0.04, p.z]);

    // Warm light pools on the floor below.
    this.pools = new THREE.MeshBasicMaterial({ map: poolTexture, color: '#ffd59a', transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const pool = new THREE.PlaneGeometry(3.4, 3.4).rotateX(-Math.PI / 2);
    inst(pool, this.pools, pendants, (p) => [p.x, 0.035, p.z]).userData.light = true;

    for (const o of this.group.children) o.userData.light = true;
  }

  /** 0 = day … 1 = night: lamps read brighter and throw stronger pools. */
  setNight(k: number) {
    this.pools.opacity = 0.12 + k * 0.55;
    this.glow.color.set('#fff0d2').multiplyScalar(1 + k * 0.6);
  }
}
