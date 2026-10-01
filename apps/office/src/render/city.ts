import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Rng } from '../util/rng';

/**
 * The neighbourhood around 500 Sansome St, San Francisco (Financial District).
 * The city is turned 90° against the compass so the office faces Sansome:
 * scene north (−z) is real east. Sansome St runs in front of the office,
 * Battery St behind it, Washington St on the left (west) and Clay St on the right.
 *
 * Neighbours: the Transamerica Pyramid + Redwood Park right across Washington,
 * big blocks along Battery behind us with One Maritime Plaza (the black X-braced
 * tower) and the Embarcadero Center slabs beyond, Jackson Square's brick
 * low-rise past Washington, the old Federal Reserve, 555/101 California and
 * Salesforce Tower to the right, the bay with the Ferry Building in the back
 * and Coit Tower on Telegraph Hill far left.
 *
 * Buildings across Clay St (between the camera and us) stay low so they never hide
 * it. Facades are merged per material (a handful of draw calls) and their
 * windows light up at night.
 */

/** Campus lot (paved) the city keeps clear of. */
export const CAMPUS = { x0: -42, z0: -4, x1: 112, z1: 80 };
/** Water (the bay) starts north of here (real east: the Embarcadero). */
const SHORE_Z = -168;

/** Block columns (x) and rows (z), separated by ~10 m streets. */
const COLS: [number, number][] = [
  [-242, -212], [-202, -172], [-162, -132], [-122, -92], [-82, -52],
  [-42, -12], [-2, 28], [38, 68], [78, 112],
  [124, 154], [164, 194], [204, 234], [244, 274], [284, 314],
];
const ROWS: [number, number][] = [
  [-164, -134], [-124, -94], [-84, -54], [-44, -14],
  [-4, 16], [26, 56], [66, 80],
  [92, 122], [132, 162], [172, 202], [212, 242],
];

/** Window grid of the facade textures: 8 windows × 8 floors per texture tile. */
const TILE_W = 24;
const TILE_H = 28;

type Facade = 'stone' | 'glass' | 'dark' | 'brick' | 'white' | 'granite';
type Bucket = Facade | 'roof' | 'slab' | 'detail' | 'grass' | 'trim';
type Rect = { x0: number; z0: number; x1: number; z1: number };

const FACADES: Record<Facade, { base: string; window: string; frame: string; rough: number; metal: number }> = {
  stone: { base: '#e6dccb', window: '#5b6b7d', frame: '#cbbfa9', rough: 0.85, metal: 0 },
  glass: { base: '#7fa3c4', window: '#9cc0dd', frame: '#5d7f9f', rough: 0.25, metal: 0.4 },
  dark: { base: '#2c323b', window: '#46546a', frame: '#20252c', rough: 0.3, metal: 0.4 },
  brick: { base: '#a85a43', window: '#3d4652', frame: '#efe6d6', rough: 0.95, metal: 0 },
  white: { base: '#f4f1ea', window: '#6c7a8b', frame: '#ddd8cd', rough: 0.7, metal: 0 },
  granite: { base: '#5e3b34', window: '#2c2a2e', frame: '#4a2f2a', rough: 0.5, metal: 0.1 },
};

class GeoBuilder {
  readonly pos: number[] = [];
  readonly nor: number[] = [];
  readonly uv: number[] = [];

  /** Quad from four corners (counter-clockwise seen from the front). */
  quad(a: number[], b: number[], c: number[], d: number[], n: number[], uv: number[][]) {
    for (const [p, t] of [[a, uv[0]], [b, uv[1]], [c, uv[2]], [a, uv[0]], [c, uv[2]], [d, uv[3]]] as const) {
      this.pos.push(...p);
      this.nor.push(...n);
      this.uv.push(...t);
    }
  }

  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    return g;
  }
}

export class City {
  readonly group = new THREE.Group();
  private readonly rng = new Rng('500-sansome');
  private readonly buckets = new Map<Bucket, GeoBuilder>();
  private readonly glowing: THREE.MeshStandardMaterial[] = [];
  private readonly trees: { x: number; z: number; s: number; y: number }[] = [];
  /** Areas taken by landmarks (no generic blocks there). */
  private readonly reserved: Rect[] = [];

  constructor() {
    this.buildGround();
    this.buildLandmarks();
    this.buildBlocks();
    this.flush();
    this.buildTrees();
    this.buildStreetNames();
    this.group.traverse((o) => {
      o.castShadow = false;
      o.receiveShadow = false;
    });
  }

  /** 0 = day … 1 = night: lit windows and glowing crowns. */
  setNight(k: number) {
    for (const m of this.glowing) m.emissiveIntensity = Math.max(0, (k - 0.15) / 0.85) * (m.userData.glow ?? 1);
  }

  // -- generic geometry ---------------------------------------------------

  private bucket(b: Bucket) {
    let g = this.buckets.get(b);
    if (!g) this.buckets.set(b, (g = new GeoBuilder()));
    return g;
  }

  /** Axis-aligned box: textured sides in `facade`, flat roof. */
  private box(facade: Bucket, x: number, z: number, w: number, d: number, y0: number, y1: number, roof: Bucket = 'roof') {
    const g = this.bucket(facade);
    let u = this.rng.int(0, 7) / 8;
    for (const [nx, nz] of [[0, 1], [1, 0], [0, -1], [-1, 0]] as const) {
      const rx = nz;
      const rz = -nx;
      const cx = x + (nx * w) / 2;
      const cz = z + (nz * d) / 2;
      const hw = (Math.abs(rx) * w) / 2 + (Math.abs(rz) * d) / 2;
      const u0 = u;
      const u1 = u + (hw * 2) / TILE_W;
      u = u1;
      const v0 = y0 / TILE_H;
      const v1 = y1 / TILE_H;
      g.quad(
        [cx - rx * hw, y0, cz - rz * hw],
        [cx + rx * hw, y0, cz + rz * hw],
        [cx + rx * hw, y1, cz + rz * hw],
        [cx - rx * hw, y1, cz - rz * hw],
        [nx, 0, nz],
        [[u0, v0], [u1, v0], [u1, v1], [u0, v1]],
      );
    }
    const r = this.bucket(roof);
    const x0 = x - w / 2;
    const x1 = x + w / 2;
    const z0 = z - d / 2;
    const z1 = z + d / 2;
    r.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]]);
  }

  private flush() {
    const mats: Record<Bucket, THREE.Material> = {
      roof: new THREE.MeshStandardMaterial({ color: '#8d9097', roughness: 0.95 }),
      slab: new THREE.MeshStandardMaterial({ color: '#c9c6bf', roughness: 0.95 }),
      detail: new THREE.MeshStandardMaterial({ color: '#b5b8be', roughness: 0.7, metalness: 0.2 }),
      grass: new THREE.MeshStandardMaterial({ color: '#8fb878', roughness: 1 }),
      trim: new THREE.MeshStandardMaterial({ color: '#f2efe8', roughness: 0.6 }),
      stone: this.facadeMaterial('stone'),
      glass: this.facadeMaterial('glass'),
      dark: this.facadeMaterial('dark'),
      brick: this.facadeMaterial('brick'),
      white: this.facadeMaterial('white'),
      granite: this.facadeMaterial('granite'),
    };
    for (const [b, g] of this.buckets) this.group.add(new THREE.Mesh(g.geometry(), mats[b]));
  }

  private facadeMaterial(f: Facade, glow = 1) {
    const spec = FACADES[f];
    const mat = new THREE.MeshStandardMaterial({
      map: facadeTexture(spec, false),
      emissiveMap: facadeTexture(spec, true),
      emissive: '#ffd28a',
      emissiveIntensity: 0,
      roughness: spec.rough,
      metalness: spec.metal,
    });
    mat.userData.glow = glow;
    this.glowing.push(mat);
    return mat;
  }

  /** Facade material for a curved/cone landmark (its own UV scale). */
  private landmarkMaterial(f: Facade, repeatU: number, repeatV: number) {
    const mat = this.facadeMaterial(f);
    for (const t of [mat.map!, mat.emissiveMap!]) t.repeat.set(repeatU, repeatV);
    return mat;
  }

  // -- ground ---------------------------------------------------------------

  private buildGround() {
    const depth = 450 - SHORE_Z;
    const asphalt = new THREE.Mesh(new THREE.PlaneGeometry(900, depth).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#5d6067', roughness: 1 }));
    asphalt.position.set(40, -0.04, SHORE_Z + depth / 2);
    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(900, 500).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: '#4c7c9e', roughness: 0.25, metalness: 0.15 }),
    );
    water.position.set(40, -0.03, SHORE_Z - 250);
    // Embarcadero promenade along the shore.
    const promenade = new THREE.Mesh(new THREE.PlaneGeometry(900, 10).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#cfc8b8', roughness: 0.95 }));
    promenade.position.set(40, -0.035, SHORE_Z + 5);
    this.group.add(asphalt, water, promenade);
  }

  // -- blocks ---------------------------------------------------------------

  private buildBlocks() {
    for (const [x0, x1] of COLS) {
      for (const [z0, z1] of ROWS) {
        const r = { x0, z0, x1, z1 };
        if (z0 < SHORE_Z + 10 || overlaps(r, CAMPUS) || this.reserved.some((q) => overlaps(r, q))) continue;
        this.buildBlock(r);
      }
    }
  }

  private buildBlock({ x0, z0, x1, z1 }: Rect) {
    const w = x1 - x0;
    const d = z1 - z0;
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    this.box('slab', cx, cz, w, d, 0, 0.18, 'slab');
    // Across Sansome St (between the camera and the office): low so nothing hides the office.
    const foreground = cz > CAMPUS.z1 && cx < 118;
    // Behind the office, along Battery St: big brick and stone blocks.
    const behind = cz < CAMPUS.z0 && cx > -50 && cx < 120;
    // Jackson Square past Washington St: historic brick low-rise.
    const jackson = cx < CAMPUS.x0 && cz > -50 && cz < CAMPUS.z1;
    const far = Math.hypot(cx - 35, cz - 30) > 190;
    if (!behind && this.rng.chance(foreground ? 0.1 : 0.06)) return this.park(x0, z0, x1, z1);

    const inset = 1.6;
    const iw = w - inset * 2;
    const id = d - inset * 2;
    const split = foreground || jackson ? this.rng.pick([2, 4, 4]) : behind ? this.rng.pick([1, 2, 2]) : this.rng.pick([1, 1, 2, 4]);
    const lots: [number, number, number, number][] = [];
    const ix = x0 + inset;
    const iz = z0 + inset;
    if (split === 1 || Math.min(iw, id) < 12) lots.push([ix, iz, iw, id]);
    else if (split === 2) {
      if (this.rng.chance(0.5)) lots.push([ix, iz, (iw - 1) / 2, id], [ix + (iw + 1) / 2, iz, (iw - 1) / 2, id]);
      else lots.push([ix, iz, iw, (id - 1) / 2], [ix, iz + (id + 1) / 2, iw, (id - 1) / 2]);
    } else {
      const hw = (iw - 1) / 2;
      const hd = (id - 1) / 2;
      for (const [a, b] of [[0, 0], [1, 0], [0, 1], [1, 1]]) lots.push([ix + a * (hw + 1), iz + b * (hd + 1), hw, hd]);
    }

    for (const [lx, lz, lw, ld] of lots) {
      const x = lx + lw / 2;
      const z = lz + ld / 2;
      if (behind || jackson) {
        // Brick and stone blocks with cornices: big behind the office, 2–4 storeys in Jackson Square.
        const facade: Facade = this.rng.pick(['brick', 'brick', 'brick', 'white', 'stone']);
        const h = behind ? this.rng.float(20, 36) : this.rng.float(8, 14);
        this.box(facade, x, z, lw, ld, 0.18, h);
        this.box('trim', x, z, lw + 0.5, ld + 0.5, h, h + 0.6);
        this.roofDetails(x, z, lw, ld, h + 0.6);
      } else if (foreground || far) {
        const facade: Facade = this.rng.pick(['stone', 'stone', 'white', 'brick', 'glass']);
        const h = foreground ? this.rng.float(8, 16) : this.rng.float(14, 34);
        this.box(facade, x, z, lw, ld, 0.18, h);
        this.roofDetails(x, z, lw, ld, h);
      } else {
        // Financial District: stone podium + tower.
        const facade: Facade = this.rng.pick(['stone', 'stone', 'glass', 'dark', 'white', 'granite']);
        const podium = this.rng.float(8, 14);
        const tower = this.rng.float(26, 62);
        this.box('stone', x, z, lw, ld, 0.18, podium);
        const t = Math.min(lw, ld) > 10 ? 2.5 : 1.2;
        this.box(facade, x, z, lw - t * 2, ld - t * 2, podium, tower);
        if (tower > 48 && Math.min(lw, ld) > 14) {
          const top = tower + this.rng.float(6, 12);
          this.box(facade, x, z, lw - t * 2 - 5, ld - t * 2 - 5, tower, top);
          this.roofDetails(x, z, lw - t * 2 - 5, ld - t * 2 - 5, top);
        } else this.roofDetails(x, z, lw - t * 2, ld - t * 2, tower);
      }
    }
  }

  private roofDetails(x: number, z: number, w: number, d: number, y: number) {
    const n = this.rng.int(0, 3);
    for (let k = 0; k < n; k++) {
      const bw = this.rng.float(1.5, Math.min(4, w / 2));
      const bd = this.rng.float(1.5, Math.min(4, d / 2));
      const bx = x + this.rng.float(-w / 2 + bw, w / 2 - bw) / 2;
      const bz = z + this.rng.float(-d / 2 + bd, d / 2 - bd) / 2;
      this.box('detail', bx, bz, bw, bd, y, y + this.rng.float(1, 2.5), 'detail');
    }
  }

  private park(x0: number, z0: number, x1: number, z1: number, density = 12) {
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    this.box('slab', cx, cz, x1 - x0 - 2, z1 - z0 - 2, 0.18, 0.25, 'grass');
    for (let k = 0; k < density; k++) {
      this.trees.push({ x: this.rng.float(x0 + 3, x1 - 3), z: this.rng.float(z0 + 3, z1 - 3), s: this.rng.float(0.8, 1.3), y: 0.25 });
    }
  }

  private buildTrees() {
    if (!this.trees.length) return;
    const trunk = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.25, 0.35, 2.4, 6).translate(0, 1.2, 0),
      new THREE.MeshStandardMaterial({ color: '#7a5a3c', roughness: 1 }),
      this.trees.length,
    );
    const crown = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(1.9, 0).translate(0, 3.6, 0),
      new THREE.MeshStandardMaterial({ color: '#5f9a55', roughness: 1, flatShading: true }),
      this.trees.length,
    );
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const v = new THREE.Vector3();
    const s = new THREE.Vector3();
    this.trees.forEach((t, i) => {
      m.compose(v.set(t.x, t.y, t.z), q.setFromAxisAngle(up, t.s * 9), s.setScalar(t.s));
      trunk.setMatrixAt(i, m);
      crown.setMatrixAt(i, m);
    });
    this.group.add(trunk, crown);
  }

  /** Street names painted on the asphalt next to the campus. */
  private buildStreetNames() {
    const label = (text: string, x: number, z: number, rot: number) => {
      const c = document.createElement('canvas');
      c.width = 512;
      c.height = 96;
      const ctx = c.getContext('2d')!;
      ctx.font = '700 60px Inter, system-ui, sans-serif';
      ctx.fillStyle = 'rgba(240,236,224,0.85)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, 256, 50);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(14, 2.6), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
      mesh.rotation.set(-Math.PI / 2, 0, rot);
      mesh.position.set(x, 0.01, z);
      this.group.add(mesh);
    };
    label('SANSOME ST', -20, 87.5, 0);
    label('BATTERY ST', 35, -9, 0);
    label('WASHINGTON ST', -47, 30, Math.PI / 2);
    label('CLAY ST', 118, 30, Math.PI / 2);
    label('MONTGOMERY ST', 35, 127, 0);
    label('JACKSON ST', -87, 30, Math.PI / 2);
  }

  // -- landmarks --------------------------------------------------------------

  private buildLandmarks() {
    this.transamerica();
    this.maritimePlaza();
    this.embarcaderoCenter();
    this.californiaStreet();
    this.federalReserve();
    this.salesforce(259, 41);
    this.coitTower(-200, 30);
    this.ferryBuilding(200, SHORE_Z - 12);
    this.skylineTowers();
    // Sydney G. Walton Square, the little park by Jackson & Front.
    this.reserved.push({ x0: -82, z0: -44, x1: -52, z1: -14 });
    this.park(-82, -44, -52, -14, 16);
  }

  /**
   * Transamerica Pyramid (600 Montgomery) on the left, right across Washington St from the office,
   * with Redwood Park at its back. It sits beside (not in front of) the office, so it never hides it.
   */
  private transamerica() {
    const area = { x0: -82, z0: -4, x1: -52, z1: 56 };
    this.reserved.push(area);
    const x = -67;
    const z = 34;
    this.box('slab', x, (area.z0 + area.z1) / 2, 30, 60, 0, 0.18, 'slab');
    // Redwood Park: a grove of tall redwoods.
    this.box('slab', x, 7, 26, 18, 0.18, 0.26, 'grass');
    for (let k = 0; k < 12; k++) this.trees.push({ x: x + this.rng.float(-11, 11), z: this.rng.float(0, 13), s: this.rng.float(1.2, 1.7), y: 0.26 });

    const half = 12;
    const h = 125;
    const r = half * Math.SQRT2;
    const body = new THREE.Mesh(new THREE.ConeGeometry(r, h, 4, 1, true).rotateY(Math.PI / 4).translate(0, h / 2, 0), this.landmarkMaterial('white', 4, 4.5));
    body.position.set(x, 0.18, z);
    const metal = new THREE.MeshStandardMaterial({ color: '#dfe3e8', roughness: 0.3, metalness: 0.6 });
    const spireH = 30;
    const spire = new THREE.Mesh(new THREE.ConeGeometry(r * (spireH / h) + 0.15, spireH, 4).rotateY(Math.PI / 4), metal);
    spire.position.set(x, 0.18 + h - spireH / 2, z);
    this.group.add(body, spire);
    // The two wings rise vertically out of the east and west faces.
    const halfAt = (y: number) => half * (1 - y / h);
    for (const sx of [-1, 1]) this.box('white', x + sx * (halfAt(73) + 1.2), z, 2.6, 7, 48, 98, 'detail');
  }

  /** One Maritime Plaza (Washington & Battery): black tower with white X-bracing outside the facade. */
  private maritimePlaza() {
    const x = -27;
    const z = -29;
    this.reserved.push({ x0: -42, z0: -44, x1: -12, z1: -14 });
    this.box('slab', x, z, 30, 30, 0, 0.18, 'slab');
    const w = 20;
    const h = 84;
    this.box('dark', x, z, w, w, 0.18, h);
    this.box('detail', x, z, w + 0.6, w + 0.6, h, h + 1.2, 'detail');
    // X-braces: one X per square panel on every face.
    const braces: THREE.BufferGeometry[] = [];
    const len = w * Math.SQRT2;
    for (let y = 4; y + w <= h; y += w) {
      for (const [nx, nz] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
        for (const s of [-1, 1]) {
          const g = new THREE.BoxGeometry(len, 0.7, 0.5).rotateZ((s * Math.PI) / 4);
          g.rotateY(Math.atan2(nx, nz));
          g.translate(x + nx * (w / 2 + 0.4), y + w / 2, z + nz * (w / 2 + 0.4));
          braces.push(g);
        }
      }
    }
    this.group.add(new THREE.Mesh(mergeGeometries(braces)!, new THREE.MeshStandardMaterial({ color: '#f2f2ee', roughness: 0.5 })));
  }

  /** Embarcadero Center: four white slab towers with vertical setbacks, towards the bay. */
  private embarcaderoCenter() {
    const towers: [number, number, number][] = [
      [53, -69, 62],
      [53, -109, 70],
      [13, -109, 66],
      [95, -109, 58],
    ];
    for (const [x, z, h] of towers) {
      this.reserved.push({ x0: x - 15, z0: z - 15, x1: x + 15, z1: z + 15 });
      const d = 30;
      this.box('slab', x, z, 30, d, 0, 0.18, 'slab');
      this.box('stone', x, z, 28, d - 4, 0.18, 9);
      this.box('white', x, z, 24, 11, 9, h);
      this.box('white', x, z, 18, 13, h * 0.55, h - 6);
      this.box('white', x, z, 12, 9, h, h + 4);
    }
  }

  /** 555 California (dark granite) and 101 California (round glass), both to the right of the office. */
  private californiaStreet() {
    this.reserved.push({ x0: 164, z0: 92, x1: 194, z1: 122 });
    this.box('slab', 179, 107, 30, 30, 0, 0.18, 'slab');
    this.box('stone', 179, 107, 28, 28, 0.18, 6);
    this.box('granite', 179, 109, 20, 18, 6, 95);
    for (const dx of [-6, 0, 6]) this.box('granite', 179 + dx, 99.4, 3, 1.2, 6, 93);
    this.box('detail', 179, 109, 20.6, 18.6, 95, 97, 'detail');

    this.reserved.push({ x0: 164, z0: -44, x1: 194, z1: -14 });
    this.box('slab', 179, -29, 30, 30, 0, 0.18, 'slab');
    const glass = this.landmarkMaterial('glass', 3, 2.6);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(10, 10, 66, 12, 1, true).translate(0, 33, 0), glass);
    shaft.position.set(179, 0.18, -29);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(6.5, 10, 9, 12).translate(0, 66 + 4.5, 0), glass);
    top.position.copy(shaft.position);
    this.group.add(shaft, top);
  }

  /** Old Federal Reserve Bank (400 Sansome) across Clay: stone hall with a colonnade facing us. */
  private federalReserve() {
    const x = 139;
    const z = 41;
    this.reserved.push({ x0: 124, z0: 26, x1: 154, z1: 56 });
    this.box('slab', x, z, 30, 30, 0, 0.18, 'slab');
    this.box('stone', x + 2, z, 22, 26, 0.18, 15);
    this.box('trim', x + 2, z, 23, 27, 15, 16.2);
    const cols: THREE.BufferGeometry[] = [];
    for (let k = 0; k < 8; k++) cols.push(new THREE.CylinderGeometry(0.6, 0.7, 12, 10).translate(x - 10.6, 6.4, z - 10.5 + k * 3));
    this.group.add(new THREE.Mesh(mergeGeometries(cols)!, new THREE.MeshStandardMaterial({ color: '#efe8da', roughness: 0.7 })));
    this.box('trim', x - 10.6, z, 1.6, 25, 12.4, 14);
  }

  /** Two skyscrapers in the background, behind the blocks across Battery St. */
  private skylineTowers() {
    // Blue-glass tower with stepped setbacks and a lit spire.
    this.reserved.push({ x0: -2, z0: -84, x1: 28, z1: -54 });
    this.box('slab', 13, -69, 30, 30, 0, 0.18, 'slab');
    this.box('stone', 13, -69, 28, 28, 0.18, 10);
    this.box('glass', 13, -69, 24, 24, 10, 78);
    this.box('glass', 13, -69, 19, 19, 78, 98);
    this.box('glass', 13, -69, 13, 13, 98, 110);
    const spireMat = new THREE.MeshStandardMaterial({ color: '#dfe3e8', roughness: 0.3, metalness: 0.6, emissive: '#ff5c5c', emissiveIntensity: 0 });
    spireMat.userData.glow = 1.5;
    this.glowing.push(spireMat);
    const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.8, 22, 8).translate(0, 11, 0), spireMat);
    spire.position.set(13, 110, -69);
    this.group.add(spire);

    // Dark granite-and-glass tower with a crown.
    this.reserved.push({ x0: 78, z0: -84, x1: 112, z1: -54 });
    this.box('slab', 95, -69, 34, 30, 0, 0.18, 'slab');
    this.box('granite', 95, -69, 30, 26, 0.18, 14);
    this.box('dark', 95, -69, 24, 20, 14, 92);
    this.box('dark', 95, -69, 18, 15, 92, 102);
    const crownMat = new THREE.MeshStandardMaterial({ color: '#c9a45c', roughness: 0.35, metalness: 0.7, emissive: '#ffd28a', emissiveIntensity: 0 });
    crownMat.userData.glow = 0.9;
    this.glowing.push(crownMat);
    const crown = new THREE.Mesh(new THREE.ConeGeometry(11, 14, 4).rotateY(Math.PI / 4).translate(0, 7, 0), crownMat);
    crown.scale.set(18 / 15.6, 1, 15 / 15.6);
    crown.position.set(95, 102, -69);
    this.group.add(crown);
  }

  /** Salesforce Tower: rounded glass shaft tapering slightly, with a glowing crown. */
  private salesforce(x: number, z: number) {
    this.reserved.push({ x0: x - 15, z0: z - 15, x1: x + 15, z1: z + 15 });
    this.box('slab', x, z, 30, 30, 0, 0.18, 'slab');
    const h = 150;
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(9, 11.5, h, 32, 1, true).translate(0, h / 2, 0), this.landmarkMaterial('glass', 3, 5.5));
    shaft.position.set(x, 0.18, z);
    const crownMat = new THREE.MeshStandardMaterial({ color: '#d7e2ec', roughness: 0.4, metalness: 0.3, emissive: '#e8f2ff', emissiveIntensity: 0, transparent: true, opacity: 0.85 });
    crownMat.userData.glow = 1.4;
    this.glowing.push(crownMat);
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(8.2, 9, 16, 32, 1, true).translate(0, h + 8, 0), crownMat);
    crown.position.set(x, 0.18, z);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(8.2, 32, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.35, 1), new THREE.MeshStandardMaterial({ color: '#c3ccd6', roughness: 0.5 }));
    cap.position.set(x, 0.18 + h + 16, z);
    this.group.add(shaft, crown, cap);
  }

  /** Coit Tower on top of a green Telegraph Hill. */
  private coitTower(x: number, z: number) {
    const rx = 46;
    const rz = 40;
    const hh = 26;
    this.reserved.push({ x0: x - rx, z0: z - rz, x1: x + rx, z1: z + rz });
    const hill = new THREE.Mesh(
      new THREE.SphereGeometry(1, 40, 14, 0, Math.PI * 2, 0, Math.PI / 2).scale(rx, hh, rz),
      new THREE.MeshStandardMaterial({ color: '#86ad6f', roughness: 1, flatShading: true }),
    );
    hill.position.set(x, -0.05, z);
    const stone = new THREE.MeshStandardMaterial({ color: '#efe6d2', roughness: 0.8 });
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 4, 28, 16).translate(0, 14, 0), stone);
    tower.position.set(x, hh - 0.6, z);
    const crownMat = new THREE.MeshStandardMaterial({ color: '#efe6d2', roughness: 0.8, emissive: '#ffe2a8', emissiveIntensity: 0 });
    crownMat.userData.glow = 0.8;
    this.glowing.push(crownMat);
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(4.3, 4.3, 3, 16).translate(0, 29.5, 0), crownMat);
    crown.position.copy(tower.position);
    this.group.add(hill, tower, crown);
    for (let k = 0; k < 26; k++) {
      const a = this.rng.float(0, Math.PI * 2);
      const t = this.rng.float(0.35, 0.85);
      const y = hh * Math.sqrt(Math.max(0, 1 - t * t)) - 0.4;
      this.trees.push({ x: x + Math.cos(a) * rx * t, z: z + Math.sin(a) * rz * t, s: this.rng.float(0.9, 1.4), y });
    }
  }

  /** Ferry Building: long hall on a pier along the shore with its clock tower, at the foot of Market Street. */
  private ferryBuilding(x: number, z: number) {
    const len = 90;
    this.box('slab', x, z, len + 10, 20, -0.03, 0.4, 'slab');
    this.box('stone', x, z, len, 13, 0.4, 11);
    this.box('stone', x, z, len - 6, 9, 11, 14, 'roof');
    this.box('stone', x, z, 8, 8, 14, 46);
    this.box('stone', x, z, 6, 6, 46, 54);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(4.6, 8, 4).rotateY(Math.PI / 4).translate(0, 4, 0), new THREE.MeshStandardMaterial({ color: '#8c7a5c', roughness: 0.8 }));
    roof.position.set(x, 54, z);
    const faceMat = new THREE.MeshStandardMaterial({ color: '#fbf6ea', roughness: 0.6, emissive: '#fff1cf', emissiveIntensity: 0 });
    faceMat.userData.glow = 1.2;
    this.glowing.push(faceMat);
    const face = new THREE.CircleGeometry(2.6, 24);
    for (const [nx, nz] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
      const m = new THREE.Mesh(face, faceMat);
      m.position.set(x + nx * 4.02, 40, z + nz * 4.02);
      m.rotation.y = Math.atan2(nx, nz);
      this.group.add(m);
    }
    this.group.add(roof);
  }
}

function overlaps(a: Rect, b: Rect) {
  return a.x0 < b.x1 && a.x1 > b.x0 && a.z0 < b.z1 && a.z1 > b.z0;
}

/** Facade tile: 8 × 8 windows. `lit` draws the night emissive map (random warm windows, rest black). */
function facadeTexture(spec: (typeof FACADES)[Facade], lit: boolean): THREE.Texture {
  const size = 512;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const cell = size / 8;
  let seed = lit ? 99 : 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  ctx.fillStyle = lit ? '#000000' : spec.base;
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 8; j++) {
      const x = i * cell + cell * 0.18;
      const y = j * cell + cell * 0.22;
      const w = cell * 0.64;
      const h = cell * 0.58;
      if (lit) {
        if (rnd() < 0.38) {
          ctx.fillStyle = rnd() < 0.8 ? '#ffd28a' : '#cfe6ff';
          ctx.fillRect(x, y, w, h);
        }
        continue;
      }
      ctx.fillStyle = spec.frame;
      ctx.fillRect(x - 3, y - 3, w + 6, h + 6);
      ctx.fillStyle = spec.window;
      ctx.globalAlpha = 0.85 + rnd() * 0.15;
      ctx.fillRect(x, y, w, h);
      ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(x, y, w * 0.35, h);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}
