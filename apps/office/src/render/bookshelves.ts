import * as THREE from 'three';
import type { Bookshelf } from '../world/layout';
import { Rng } from '../util/rng';

const BOOK_COLORS = ['#8c2f39', '#2f5d8a', '#3f7d4e', '#c9a227', '#6b3e75', '#d9774b', '#1f2a44', '#e8dcc0', '#a33b20', '#4f8a8b', '#5a3a22', '#b84f6b'];

/**
 * Open wooden shelving filled with book spines of random height, width and colour.
 * Frames and books are two instanced meshes, so a whole library is a couple of draw calls.
 */
export class Bookshelves {
  readonly group = new THREE.Group();

  constructor(shelves: Bookshelf[]) {
    if (!shelves.length) return;
    const rng = new Rng('library-books');
    const frameParts: THREE.Matrix4[] = [];
    const books: { m: THREE.Matrix4; color: string }[] = [];
    const local = new THREE.Matrix4();
    const place = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const v = new THREE.Vector3();
    const s = new THREE.Vector3();
    const part = (x: number, y: number, z: number, sx: number, sy: number, sz: number, out: THREE.Matrix4) =>
      out.compose(v.set(x, y, z), q.identity(), s.set(sx, sy, sz));

    for (const sh of shelves) {
      place.compose(v.set(sh.x, 0, sh.z), q.setFromAxisAngle(up, sh.rot), s.set(1, 1, 1));
      const { w, d, h } = sh;
      const t = 0.06;
      const levels = 5;
      const pitch = (h - t) / levels;
      const add = (x: number, y: number, z: number, sx: number, sy: number, sz: number) =>
        frameParts.push(place.clone().multiply(part(x, y, z, sx, sy, sz, local)));
      // Back panel, sides and the shelf boards (bottom to top).
      add(0, h / 2, -d / 2 + t / 2, w, h, t);
      for (const sx of [-1, 1]) add(sx * (w / 2 - t / 2), h / 2, 0, t, h, d);
      for (let k = 0; k <= levels; k++) add(0, k * pitch + t / 2, 0, w, t, d);

      // Books on every shelf, standing left to right with the odd gap.
      for (let k = 0; k < levels; k++) {
        const y0 = k * pitch + t;
        let x = -w / 2 + t + 0.03;
        const xEnd = w / 2 - t - 0.03;
        while (x < xEnd - 0.05) {
          if (rng.chance(0.06)) {
            x += rng.float(0.1, 0.25);
            continue;
          }
          const bw = rng.float(0.05, 0.11);
          if (x + bw > xEnd) break;
          const bh = rng.float(0.55, 0.85) * (pitch - t);
          const bd = d * rng.float(0.65, 0.85);
          const m = place.clone().multiply(part(x + bw / 2, y0 + bh / 2, -d / 2 + t + bd / 2, bw * 0.92, bh, bd, local));
          books.push({ m, color: rng.pick(BOOK_COLORS) });
          x += bw;
        }
      }
    }

    const box = new THREE.BoxGeometry(1, 1, 1);
    const frames = new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial({ color: '#8a5f3c', roughness: 0.8 }), frameParts.length);
    frameParts.forEach((m, i) => frames.setMatrixAt(i, m));
    const bookMesh = new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.75 }), books.length);
    const c = new THREE.Color();
    books.forEach((b, i) => {
      bookMesh.setMatrixAt(i, b.m);
      bookMesh.setColorAt(i, c.set(b.color));
    });
    frames.castShadow = frames.receiveShadow = true;
    bookMesh.receiveShadow = true;
    this.group.add(frames, bookMesh);
  }
}
