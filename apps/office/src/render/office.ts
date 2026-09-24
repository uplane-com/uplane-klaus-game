import * as THREE from 'three';
import { PLAZA } from '../config/office';
import { BIKE_RACK, BUS_STOP_X, HELIPAD, ROAD } from '../config/transport';
import type { FurnitureModel } from '../config/scale';
import type { Board, FloorPattern, OfficeLayout } from '../world/layout';
import type { ModelProto } from './assets';

/**
 * Static office geometry. Everything repeated is an InstancedMesh, so the
 * whole office is a few dozen draw calls regardless of desk count.
 */
export class OfficeView {
  readonly group = new THREE.Group();
  private screens!: THREE.InstancedMesh;
  private leds!: THREE.InstancedMesh;
  private ledTimer = 0;
  private readonly tmpColor = new THREE.Color();

  constructor(
    private readonly layout: OfficeLayout,
    furniture: Map<FurnitureModel, ModelProto>,
  ) {
    this.buildGround();
    this.buildFloors();
    this.buildWalls();
    this.buildFurniture(furniture);
    this.buildScreens();
    this.buildDashboards();
    this.buildBoards();
    this.buildTables();
    this.buildRacks();
    this.buildTrees();
    this.buildLabels();
    this.buildStreetProps();
    this.buildRugs();
    this.buildProps();
  }

  // -- public -------------------------------------------------------------

  /** Colour a desk monitor (e.g. by the status of the agent sitting there). */
  setScreen(index: number, color: THREE.ColorRepresentation) {
    this.screens.setColorAt(index, this.tmpColor.set(color));
    this.screens.instanceColor!.needsUpdate = true;
  }

  update(dt: number) {
    this.ledTimer -= dt;
    if (this.ledTimer > 0) return;
    this.ledTimer = 0.18;
    const palette = ['#38e07b', '#38e07b', '#38e07b', '#4fc3ff', '#ffb020', '#1d2a22'];
    for (let i = 0; i < this.leds.count; i++) {
      if (Math.random() < 0.25) this.leds.setColorAt(i, this.tmpColor.set(palette[(Math.random() * palette.length) | 0]));
    }
    this.leds.instanceColor!.needsUpdate = true;
  }

  // -- builders -----------------------------------------------------------

  private buildGround() {
    const grass = new THREE.Mesh(
      new THREE.PlaneGeometry(600, 600),
      new THREE.MeshStandardMaterial({ color: '#9dbf86', roughness: 1 }),
    );
    grass.rotation.x = -Math.PI / 2;
    grass.position.set(48, -0.02, 32);
    grass.receiveShadow = true;
    this.group.add(grass);

    // Road beyond the plaza.
    const road = new THREE.Mesh(
      new THREE.PlaneGeometry(600, 10),
      new THREE.MeshStandardMaterial({ color: '#4a4d55', roughness: 1 }),
    );
    road.rotation.x = -Math.PI / 2;
    road.position.set(48, -0.01, PLAZA.z1 + 5);
    road.receiveShadow = true;
    this.group.add(road);
    const dashGeo = new THREE.PlaneGeometry(2.5, 0.25);
    dashGeo.rotateX(-Math.PI / 2);
    const dashes = new THREE.InstancedMesh(dashGeo, new THREE.MeshBasicMaterial({ color: '#e9e4d0' }), 120);
    const m = new THREE.Matrix4();
    for (let i = 0; i < 120; i++) {
      m.makeTranslation(-250 + i * 5, 0, PLAZA.z1 + 5);
      dashes.setMatrixAt(i, m);
    }
    this.group.add(dashes);
  }

  private buildFloors() {
    const base = new Map<FloorPattern, THREE.Texture>();
    for (const f of this.layout.floors) {
      let tex = base.get(f.pattern);
      if (!tex) {
        tex = floorTexture(f.pattern);
        base.set(f.pattern, tex);
      }
      const w = f.x1 - f.x0;
      const d = f.z1 - f.z0;
      const map = tex.clone();
      const tile = FLOOR_TILE[f.pattern];
      map.repeat.set(w / tile, d / tile);
      map.needsUpdate = true;
      const geo = new THREE.PlaneGeometry(w, d);
      geo.rotateX(-Math.PI / 2);
      // Tint the texture slightly towards the room colour.
      const tint = new THREE.Color(f.color).lerp(new THREE.Color('#ffffff'), f.pattern === 'wood' ? 0.55 : 0.75);
      const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map, color: tint, roughness: f.pattern === 'concrete' ? 0.7 : 0.85 }));
      mesh.position.set((f.x0 + f.x1) / 2, f.y, (f.z0 + f.z1) / 2);
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
  }

  private buildRugs() {
    const rugs = this.layout.rugs;
    if (!rugs.length) return;
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({ map: rugTexture(), roughness: 1, alphaTest: 0.5 });
    const inst = new THREE.InstancedMesh(geo, mat, rugs.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    rugs.forEach((r, i) => {
      m.compose(new THREE.Vector3(r.x, 0.02, r.z), q, new THREE.Vector3(r.w, 1, r.d));
      inst.setMatrixAt(i, m);
      inst.setColorAt(i, this.tmpColor.set(r.color));
    });
    inst.receiveShadow = true;
    this.group.add(inst);
  }

  private buildWalls() {
    const outer = this.layout.walls.filter((w) => w.outer);
    const inner = this.layout.walls.filter((w) => !w.outer);
    const box = new THREE.BoxGeometry(1, 1, 1);
    box.translate(0, 0.5, 0);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const set = (inst: THREE.InstancedMesh, i: number, x: number, y: number, z: number, sx: number, sy: number, sz: number) => {
      m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(sx, sy, sz));
      inst.setMatrixAt(i, m);
    };

    // Outer building walls: solid, cut away at a low height.
    const body = new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial({ color: '#f7f5f0', roughness: 0.9 }), Math.max(1, outer.length));
    const cap = new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial({ color: '#2f3440', roughness: 0.7 }), Math.max(1, outer.length));
    outer.forEach((w, i) => {
      set(body, i, w.x, 0, w.z, w.w, w.h, w.d);
      set(cap, i, w.x, w.h, w.z, w.w + 0.02, 0.06, w.d + 0.02);
    });
    body.castShadow = body.receiveShadow = true;
    this.group.add(body, cap);

    // Interior glass partitions: low solid base, glass pane, slim frame + mullions.
    const baseH = 0.3;
    const plinth = new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial({ color: '#e4e0d8', roughness: 0.8 }), Math.max(1, inner.length));
    const rail = new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial({ color: '#b7bfcc', roughness: 0.4, metalness: 0.5 }), Math.max(1, inner.length));
    const glass = new THREE.InstancedMesh(
      box,
      new THREE.MeshStandardMaterial({ color: '#d7e8ff', transparent: true, opacity: 0.22, roughness: 0.05, metalness: 0.2, depthWrite: false }),
      Math.max(1, inner.length),
    );
    const posts: [number, number, number][] = [];
    inner.forEach((w, i) => {
      const alongX = w.w > w.d;
      const len = alongX ? w.w : w.d;
      set(plinth, i, w.x, 0, w.z, w.w, baseH, w.d);
      set(glass, i, w.x, baseH, w.z, alongX ? w.w : 0.05, w.h - baseH, alongX ? 0.05 : w.d);
      set(rail, i, w.x, w.h - 0.05, w.z, alongX ? w.w : 0.1, 0.07, alongX ? 0.1 : w.d);
      const n = Math.max(1, Math.round(len / 2.4));
      for (let k = 0; k <= n; k++) {
        const t = -len / 2 + (len * k) / n;
        posts.push(alongX ? [w.x + t, w.z, w.h] : [w.x, w.z + t, w.h]);
      }
    });
    const mullions = new THREE.InstancedMesh(box, rail.material, Math.max(1, posts.length));
    posts.forEach(([x, z, h], i) => set(mullions, i, x, 0, z, 0.07, h, 0.07));
    plinth.receiveShadow = true;
    glass.renderOrder = 3;
    this.group.add(plinth, rail, mullions, glass);
  }

  private buildFurniture(protos: Map<FurnitureModel, ModelProto>) {
    const byModel = new Map<FurnitureModel, typeof this.layout.placements>();
    for (const p of this.layout.placements) {
      const list = byModel.get(p.model) ?? [];
      list.push(p);
      byModel.set(p.model, list);
    }
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const one = new THREE.Vector3(1, 1, 1);
    for (const [model, list] of byModel) {
      const proto = protos.get(model);
      if (!proto) continue;
      const small = model === 'computerKeyboard' || model === 'books' || model.startsWith('plantSmall') || model.startsWith('rug');
      for (const part of proto) {
        const inst = new THREE.InstancedMesh(part.geometry, part.material, list.length);
        list.forEach((p, i) => {
          q.setFromAxisAngle(up, p.rot + (MODEL_YAW[model] ?? 0));
          m.compose(new THREE.Vector3(p.x, p.y ?? 0, p.z), q, one);
          inst.setMatrixAt(i, m);
        });
        inst.castShadow = !small;
        inst.receiveShadow = true;
        this.group.add(inst);
      }
    }
  }

  private buildScreens() {
    const mons = this.layout.monitors;
    const geo = new THREE.PlaneGeometry(0.82, 0.46);
    this.screens = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }), Math.max(1, mons.length));
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    mons.forEach((mon, i) => {
      // Monitor rot points from the monitor towards the seat; the glow faces the agent.
      q.setFromAxisAngle(up, mon.rot);
      const fx = Math.sin(mon.rot) * 0.075;
      const fz = Math.cos(mon.rot) * 0.075;
      m.compose(new THREE.Vector3(mon.x + fx, mon.y + 0.47, mon.z + fz), q, new THREE.Vector3(1, 1, 1));
      this.screens.setMatrixAt(i, m);
      this.screens.setColorAt(i, this.tmpColor.set('#1b2130'));
    });
    this.group.add(this.screens);
  }

  /** Command-centre dashboards: dark screens with charts in a few tints. */
  private buildDashboards() {
    const list = this.layout.extraScreens;
    if (!list.length) return;
    const geo = new THREE.PlaneGeometry(0.82, 0.46);
    const mat = new THREE.MeshBasicMaterial({ map: boardTexture('screen'), toneMapped: false });
    const inst = new THREE.InstancedMesh(geo, mat, list.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const tints = ['#ffffff', '#9fffc8', '#ffd28a', '#9cc6ff', '#ff9c9c'];
    list.forEach((sc, i) => {
      q.setFromAxisAngle(up, sc.rot);
      m.compose(new THREE.Vector3(sc.x + Math.sin(sc.rot) * 0.075, sc.y + 0.47, sc.z + Math.cos(sc.rot) * 0.075), q, new THREE.Vector3(1, 1, 1));
      inst.setMatrixAt(i, m);
      inst.setColorAt(i, this.tmpColor.set(tints[i % tints.length]));
    });
    this.group.add(inst);
  }

  private buildBoards() {
    const textures = new Map<Board['kind'], THREE.Texture>();
    const frameMat = new THREE.MeshStandardMaterial({ color: '#b9bec8', roughness: 0.6 });
    const legGeo = new THREE.BoxGeometry(0.08, 0.7, 0.08);
    for (const b of this.layout.boards) {
      let tex = textures.get(b.kind);
      if (!tex) {
        tex = boardTexture(b.kind);
        textures.set(b.kind, tex);
      }
      const g = new THREE.Group();
      const frame = new THREE.Mesh(new THREE.BoxGeometry(b.w + 0.12, 1.5, 0.08), frameMat);
      frame.position.y = 1.45;
      frame.castShadow = true;
      const face = new THREE.Mesh(new THREE.PlaneGeometry(b.w, 1.38), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
      face.position.set(0, 1.45, 0.045);
      g.add(frame, face);
      for (const s of [-1, 1]) {
        const leg = new THREE.Mesh(legGeo, frameMat);
        leg.position.set((s * b.w) / 2.2, 0.35, 0);
        g.add(leg);
      }
      g.position.set(b.x, 0, b.z);
      g.rotation.y = b.rot;
      this.group.add(g);
    }
  }

  private buildTables() {
    const tables = this.layout.tables;
    const box = new THREE.BoxGeometry(1, 1, 1);
    const cyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 24);
    const topMat = new THREE.MeshStandardMaterial({ color: '#c89f73', roughness: 0.7 });
    const legMat = new THREE.MeshStandardMaterial({ color: '#5b5f68', roughness: 0.6 });
    const square = tables.filter((t) => !t.round);
    const round = tables.filter((t) => t.round);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const tops = new THREE.InstancedMesh(box, topMat, Math.max(1, square.length));
    const rtops = new THREE.InstancedMesh(cyl, topMat, Math.max(1, round.length));
    const legs = new THREE.InstancedMesh(box, legMat, Math.max(1, square.length * 4 + round.length));
    let li = 0;
    square.forEach((t, i) => {
      m.compose(new THREE.Vector3(t.x, t.h - 0.05, t.z), q, new THREE.Vector3(t.w, 0.1, t.d));
      tops.setMatrixAt(i, m);
      for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        m.compose(new THREE.Vector3(t.x + sx * (t.w / 2 - 0.15), (t.h - 0.1) / 2, t.z + sz * (t.d / 2 - 0.15)), q, new THREE.Vector3(0.1, t.h - 0.1, 0.1));
        legs.setMatrixAt(li++, m);
      }
    });
    round.forEach((t, i) => {
      m.compose(new THREE.Vector3(t.x, t.h - 0.05, t.z), q, new THREE.Vector3(t.w, 0.1, t.d));
      rtops.setMatrixAt(i, m);
      m.compose(new THREE.Vector3(t.x, (t.h - 0.1) / 2, t.z), q, new THREE.Vector3(0.14, t.h - 0.1, 0.14));
      legs.setMatrixAt(li++, m);
    });
    legs.count = li;
    tops.count = square.length;
    rtops.count = round.length;
    for (const x of [tops, rtops, legs]) {
      x.castShadow = x.receiveShadow = true;
      this.group.add(x);
    }
  }

  private buildRacks() {
    const racks = this.layout.racks;
    const box = new THREE.BoxGeometry(1, 1, 1);
    box.translate(0, 0.5, 0);
    const body = new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial({ color: '#262a33', roughness: 0.5, metalness: 0.3 }), Math.max(1, racks.length));
    const ledsPer = 8;
    const ledGeo = new THREE.BoxGeometry(0.02, 0.05, 0.12);
    this.leds = new THREE.InstancedMesh(ledGeo, new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }), Math.max(1, racks.length * ledsPer));
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    let li = 0;
    racks.forEach((r, i) => {
      m.compose(new THREE.Vector3(r.x, 0, r.z), q, new THREE.Vector3(r.w, r.h, r.d - 0.08));
      body.setMatrixAt(i, m);
      for (let k = 0; k < ledsPer; k++) {
        const y = 0.4 + k * 0.25;
        const off = (k % 2 === 0 ? -0.25 : 0.25) + ((k * 37) % 5) * 0.03 - 0.06;
        m.compose(new THREE.Vector3(r.x + r.face * (r.w / 2 + 0.01), y, r.z + off), q, new THREE.Vector3(1, 1, 1));
        this.leds.setMatrixAt(li, m);
        this.leds.setColorAt(li, this.tmpColor.set('#38e07b'));
        li++;
      }
    });
    body.castShadow = body.receiveShadow = true;
    this.group.add(body, this.leds);
  }

  private buildTrees() {
    const trees = this.layout.trees;
    const trunk = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.15, 0.22, 1.6, 6).translate(0, 0.8, 0),
      new THREE.MeshStandardMaterial({ color: '#7a5a3c' }),
      trees.length,
    );
    const crownGeo = new THREE.IcosahedronGeometry(1.5, 0).translate(0, 2.8, 0);
    const crown = new THREE.InstancedMesh(crownGeo, new THREE.MeshStandardMaterial({ color: '#5f9b57', flatShading: true }), trees.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    trees.forEach((t, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.x);
      m.compose(new THREE.Vector3(t.x, 0, t.z), q, new THREE.Vector3(t.s, t.s, t.s));
      trunk.setMatrixAt(i, m);
      crown.setMatrixAt(i, m);
    });
    trunk.castShadow = crown.castShadow = true;
    this.group.add(trunk, crown);
  }

  private buildStreetProps() {
    const g = this.group;
    const add = (geo: THREE.BufferGeometry, color: string, x: number, y: number, z: number, opts: Partial<THREE.MeshStandardMaterialParameters> = {}) => {
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.7, ...opts }));
      m.position.set(x, y, z);
      m.castShadow = m.receiveShadow = true;
      g.add(m);
      return m;
    };
    // Curb stone along the plaza edge.
    add(new THREE.BoxGeometry(PLAZA.x1 - PLAZA.x0, 0.12, 0.35), '#e3e1da', (PLAZA.x0 + PLAZA.x1) / 2, 0.06, ROAD.curbZ + 0.1);

    // Bus stop: shelter with roof, back glass and bench, plus a sign pole.
    const sh = this.layout.transport.shelter;
    add(new THREE.BoxGeometry(sh.w + 0.6, 0.12, sh.d + 0.8), '#2b2f38', sh.x, sh.h, sh.z + 0.2);
    add(new THREE.BoxGeometry(sh.w, sh.h - 0.2, 0.06), '#bcd7ff', sh.x, (sh.h - 0.2) / 2, sh.z - sh.d / 2 + 0.05, { transparent: true, opacity: 0.35, roughness: 0.1 });
    for (const dx of [-sh.w / 2, sh.w / 2]) add(new THREE.BoxGeometry(0.1, sh.h, 0.1), '#2b2f38', sh.x + dx, sh.h / 2, sh.z - sh.d / 2 + 0.05);
    add(new THREE.BoxGeometry(sh.w - 1, 0.1, 0.5), '#c89f73', sh.x, 0.5, sh.z - 0.15);
    add(new THREE.CylinderGeometry(0.06, 0.06, 2.6, 8), '#2b2f38', BUS_STOP_X + 4, 1.3, ROAD.curbZ - 0.6);
    const signTex = canvasTexture(128, 128, (ctx) => {
      ctx.fillStyle = '#1a44ff';
      ctx.beginPath();
      ctx.arc(64, 64, 60, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 72px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('H', 64, 90);
    });
    const sign = new THREE.Mesh(new THREE.CircleGeometry(0.4, 24), new THREE.MeshBasicMaterial({ map: signTex, side: THREE.DoubleSide }));
    sign.position.set(BUS_STOP_X + 4, 2.7, ROAD.curbZ - 0.6);
    g.add(sign);
    // Bus lane marking.
    const busText = canvasTexture(256, 64, (ctx) => {
      ctx.fillStyle = '#f5f1e0';
      ctx.font = 'bold 54px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('BUS', 128, 52);
    });
    const busMark = new THREE.Mesh(new THREE.PlaneGeometry(3, 0.75), new THREE.MeshBasicMaterial({ map: busText, transparent: true }));
    // Reads for westbound drivers (right-hand traffic), painted inside the bay.
    busMark.rotation.set(-Math.PI / 2, 0, Math.PI / 2);
    busMark.position.set(BUS_STOP_X + 2, 0.01, ROAD.stopZ);
    g.add(busMark);

    // Bike rack.
    const rackW = BIKE_RACK.slots * BIKE_RACK.spacing;
    add(new THREE.BoxGeometry(rackW, 0.08, 0.08), '#9aa1ad', BIKE_RACK.x0 + rackW / 2 - BIKE_RACK.spacing / 2, 0.55, BIKE_RACK.z, { metalness: 0.6, roughness: 0.3 });
    for (let k = 0; k < BIKE_RACK.slots; k++) {
      add(new THREE.BoxGeometry(0.05, 0.55, 0.05), '#9aa1ad', BIKE_RACK.x0 + k * BIKE_RACK.spacing, 0.28, BIKE_RACK.z, { metalness: 0.6, roughness: 0.3 });
    }

    // Helipad.
    const padTex = canvasTexture(256, 256, (ctx) => {
      ctx.fillStyle = '#3a3f4a';
      ctx.beginPath();
      ctx.arc(128, 128, 126, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#f5f1e0';
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.arc(128, 128, 100, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#f5f1e0';
      ctx.font = 'bold 130px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('H', 128, 175);
    });
    const pad = new THREE.Mesh(new THREE.CircleGeometry(HELIPAD.r, 40), new THREE.MeshStandardMaterial({ map: padTex, transparent: true, roughness: 0.9 }));
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(HELIPAD.x, 0.03, HELIPAD.z);
    pad.receiveShadow = true;
    g.add(pad);
  }

  private buildProps() {
    const props = this.layout.props;
    const std = (color: string, opts: Partial<THREE.MeshStandardMaterialParameters> = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.7, ...opts });
    const add = (parent: THREE.Object3D, geo: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number) => {
      const mesh = new THREE.Mesh(geo, material);
      mesh.position.set(x, y, z);
      mesh.castShadow = mesh.receiveShadow = true;
      parent.add(mesh);
      return mesh;
    };

    const bags = props.filter((p) => p.kind === 'beanbag');
    if (bags.length) {
      const geo = new THREE.IcosahedronGeometry(0.55, 2);
      geo.scale(1, 0.62, 1);
      geo.translate(0, 0.32, 0);
      const inst = new THREE.InstancedMesh(geo, std('#ffffff', { roughness: 0.95, flatShading: true }), bags.length);
      const m = new THREE.Matrix4();
      bags.forEach((b, i) => {
        m.makeRotationY(b.rot).setPosition(b.x, 0, b.z);
        inst.setMatrixAt(i, m);
        inst.setColorAt(i, this.tmpColor.set(b.color ?? '#ff5c5c'));
      });
      inst.castShadow = true;
      this.group.add(inst);
    }

    for (const p of props) {
      const g = new THREE.Group();
      g.position.set(p.x, 0, p.z);
      g.rotation.y = p.rot;
      switch (p.kind) {
        case 'pingpong': {
          add(g, new THREE.BoxGeometry(1.5, 0.06, 2.7), std('#1f6f55'), 0, 0.76, 0);
          add(g, new THREE.BoxGeometry(0.03, 0.005, 2.7), std('#ffffff'), 0, 0.795, 0);
          add(g, new THREE.BoxGeometry(1.7, 0.16, 0.02), std('#f4f5f8', { transparent: true, opacity: 0.8 }), 0, 0.87, 0);
          for (const [x, z] of [[-0.6, -1.1], [0.6, -1.1], [-0.6, 1.1], [0.6, 1.1]]) add(g, new THREE.BoxGeometry(0.06, 0.74, 0.06), std('#2b2f38'), x, 0.37, z);
          break;
        }
        case 'foosball': {
          add(g, new THREE.BoxGeometry(1.2, 0.3, 0.7), std('#c89f73'), 0, 0.72, 0);
          add(g, new THREE.BoxGeometry(1.1, 0.02, 0.6), std('#3aa655'), 0, 0.875, 0);
          for (let k = 0; k < 4; k++) {
            const rod = add(g, new THREE.CylinderGeometry(0.015, 0.015, 1.0, 6), std('#c7ccd6', { metalness: 0.6 }), -0.4 + k * 0.27, 0.93, 0);
            rod.rotation.x = Math.PI / 2;
            for (const z of [-0.18, 0, 0.18]) add(g, new THREE.BoxGeometry(0.04, 0.1, 0.04), std(k % 2 ? '#1a44ff' : '#ff5c5c'), -0.4 + k * 0.27, 0.9, z);
          }
          for (const [x, z] of [[-0.5, -0.28], [0.5, -0.28], [-0.5, 0.28], [0.5, 0.28]]) add(g, new THREE.BoxGeometry(0.08, 0.58, 0.08), std('#8a6a48'), x, 0.29, z);
          break;
        }
        case 'lightbox': {
          // Big backlit sign above the receptionists' heads.
          const tex = logoTexture('#0a0a0a', '#ffffff', 1024, 284);
          add(g, new THREE.BoxGeometry(6.6, 1.9, 0.2), std('#0a0a0a'), 0, 2.15, 0);
          const face = new THREE.Mesh(new THREE.PlaneGeometry(6.45, 1.79), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
          face.position.set(0, 2.15, 0.105);
          g.add(face);
          for (const x of [-2.9, 2.9]) add(g, new THREE.BoxGeometry(0.1, 1.2, 0.1), std('#2b2f38'), x, 0.6, 0);
          break;
        }
        case 'floorLogo': {
          const tex = logoTexture('rgba(0,0,0,0)', '#0a0a0a', 1024, 256);
          const plane = new THREE.Mesh(new THREE.PlaneGeometry(8, 2), new THREE.MeshStandardMaterial({ map: tex, transparent: true, opacity: 0.9, roughness: 0.6, depthWrite: false }));
          plane.rotation.x = -Math.PI / 2;
          plane.position.y = 0.025;
          plane.receiveShadow = true;
          g.add(plane);
          break;
        }
        case 'easel': {
          const wood = std('#b88a5a');
          for (const [x, rz] of [[-0.32, 0.12], [0.32, -0.12]] as const) {
            const leg = add(g, new THREE.BoxGeometry(0.06, 1.9, 0.06), wood, x, 0.92, 0.1);
            leg.rotation.set(0.12, 0, rz);
          }
          const back = add(g, new THREE.BoxGeometry(0.06, 1.8, 0.06), wood, 0, 0.85, -0.3);
          back.rotation.x = -0.28;
          add(g, new THREE.BoxGeometry(0.9, 0.05, 0.12), wood, 0, 0.62, 0.02);
          const canvas = add(g, new THREE.BoxGeometry(0.85, 0.7, 0.04), std('#fbfaf7'), 0, 1.02, 0.0);
          canvas.rotation.x = -0.12;
          const paint = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.56), new THREE.MeshBasicMaterial({ map: canvasArt(p.color ?? '#ff5c5c') }));
          paint.position.set(0, 1.02, 0.025);
          paint.rotation.x = -0.12;
          g.add(paint);
          break;
        }
        case 'softbox': {
          const metal = std('#2b2f38', { metalness: 0.5, roughness: 0.4 });
          add(g, new THREE.CylinderGeometry(0.025, 0.025, 1.9, 6), metal, 0, 0.95, 0);
          for (let k = 0; k < 3; k++) {
            const leg = add(g, new THREE.CylinderGeometry(0.02, 0.02, 0.7, 5), metal, Math.sin((k / 3) * Math.PI * 2) * 0.22, 0.25, Math.cos((k / 3) * Math.PI * 2) * 0.22);
            leg.rotation.set(Math.cos((k / 3) * Math.PI * 2) * 0.6, 0, -Math.sin((k / 3) * Math.PI * 2) * 0.6);
          }
          const head = new THREE.Group();
          head.position.set(0, 1.95, 0.1);
          head.rotation.x = 0.25;
          add(head, new THREE.BoxGeometry(0.85, 0.85, 0.35), std('#1c1f26'), 0, 0, 0);
          const diffuser = new THREE.Mesh(new THREE.PlaneGeometry(0.78, 0.78), new THREE.MeshBasicMaterial({ color: '#fff8ea', toneMapped: false }));
          diffuser.position.z = 0.18;
          head.add(diffuser);
          g.add(head);
          break;
        }
        case 'cameraRig': {
          const metal = std('#2b2f38', { metalness: 0.5, roughness: 0.4 });
          for (let k = 0; k < 3; k++) {
            const a = (k / 3) * Math.PI * 2;
            const leg = add(g, new THREE.CylinderGeometry(0.02, 0.02, 1.3, 5), metal, Math.sin(a) * 0.22, 0.62, Math.cos(a) * 0.22);
            leg.rotation.set(Math.cos(a) * 0.35, 0, -Math.sin(a) * 0.35);
          }
          add(g, new THREE.BoxGeometry(0.34, 0.24, 0.22), std('#15171c', { roughness: 0.4 }), 0, 1.35, 0);
          const lens = add(g, new THREE.CylinderGeometry(0.08, 0.09, 0.2, 12), std('#0b0c10', { roughness: 0.3 }), 0, 1.35, 0.2);
          lens.rotation.x = Math.PI / 2;
          add(g, new THREE.SphereGeometry(0.025, 6, 6), new THREE.MeshBasicMaterial({ color: '#ff3b3b' }), 0.12, 1.49, 0.05);
          break;
        }
        case 'backdrop': {
          // Paper roll on two stands, sweeping onto the floor.
          const metal = std('#2b2f38', { metalness: 0.5, roughness: 0.4 });
          for (const x of [-2.3, 2.3]) add(g, new THREE.CylinderGeometry(0.03, 0.03, 2.6, 6), metal, x, 1.3, 0);
          const roll = add(g, new THREE.CylinderGeometry(0.09, 0.09, 4.7, 10), std(p.color ?? '#ffb3c7'), 0, 2.55, 0);
          roll.rotation.z = Math.PI / 2;
          const paperMat = std(p.color ?? '#ffb3c7', { roughness: 0.95, side: THREE.DoubleSide });
          add(g, new THREE.PlaneGeometry(4.4, 2.4), paperMat, 0, 1.3, 0.02);
          const sweep = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 4.4, 12, 1, true, Math.PI, Math.PI / 2), paperMat);
          sweep.rotation.z = Math.PI / 2;
          sweep.position.set(0, 0.6, 0.62);
          sweep.receiveShadow = true;
          g.add(sweep);
          add(g, new THREE.PlaneGeometry(4.4, 1.2), paperMat, 0, 0.012, 1.8).rotation.x = -Math.PI / 2;
          break;
        }
        case 'neon': {
          // Dark panel on two posts with the glowing lettering in front.
          add(g, new THREE.BoxGeometry(4.3, 1.2, 0.08), std('#1b1d24', { roughness: 0.5 }), 0, 1.75, 0);
          for (const x of [-1.9, 1.9]) add(g, new THREE.BoxGeometry(0.08, 1.2, 0.08), std('#2b2f38'), x, 0.6, 0);
          const sign = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 1.05), new THREE.MeshBasicMaterial({ map: neonTexture('make it pop'), transparent: true, toneMapped: false, depthWrite: false }));
          sign.position.set(0, 1.75, 0.05);
          g.add(sign);
          break;
        }
        case 'onAir': {
          add(g, new THREE.BoxGeometry(1.3, 0.42, 0.1), std('#1b1d24'), 0, 1.55, 0);
          const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.22, 0.34), new THREE.MeshBasicMaterial({ map: onAirTexture(), toneMapped: false }));
          sign.position.set(0, 1.55, 0.056);
          g.add(sign);
          break;
        }
        case 'foam': {
          // 3x3 acoustic foam tiles.
          const foamMat = std('#3b2f5c', { roughness: 1, flatShading: true });
          const tile = new THREE.ConeGeometry(0.28, 0.12, 4).rotateX(Math.PI / 2).rotateZ(Math.PI / 4);
          for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) add(g, tile, foamMat, -0.6 + i * 0.6, 0.55 + j * 0.45, 0.06);
          break;
        }
        case 'mic': {
          const metal = std('#2b2f38', { metalness: 0.6, roughness: 0.35 });
          add(g, new THREE.CylinderGeometry(0.08, 0.09, 0.03, 10), metal, 0, 0.8, 0);
          add(g, new THREE.CylinderGeometry(0.012, 0.012, 0.28, 6), metal, 0, 0.94, 0);
          const arm = add(g, new THREE.CylinderGeometry(0.012, 0.012, 0.3, 6), metal, 0, 1.1, 0.12);
          arm.rotation.x = 1.0;
          const mic = add(g, new THREE.CapsuleGeometry(0.05, 0.12, 4, 8), std('#15171c', { roughness: 0.3 }), 0, 1.16, 0.26);
          mic.rotation.x = 0.4;
          break;
        }
        case 'newsDesk': {
          // Curved-look anchor desk: white top, dark front with the logo.
          add(g, new THREE.BoxGeometry(4.4, 0.08, 1.2), std('#f4f5f8', { roughness: 0.3 }), 0, 0.95, 0);
          add(g, new THREE.BoxGeometry(4.2, 0.9, 0.9), std('#1a44ff', { roughness: 0.4 }), 0, 0.46, 0.05);
          const logo = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.66), new THREE.MeshBasicMaterial({ map: logoTexture('#1a44ff', '#ffffff', 512, 142), toneMapped: false }));
          logo.position.set(0, 0.48, 0.505);
          g.add(logo);
          break;
        }
        case 'robotDock': {
          // Round charging pad with a glowing ring + a pillar with a status screen behind it.
          add(g, new THREE.CylinderGeometry(0.62, 0.66, 0.06, 24), std('#2b2f38', { metalness: 0.4, roughness: 0.4 }), 0, 0.03, 0);
          const ring = new THREE.Mesh(new THREE.TorusGeometry(0.52, 0.025, 6, 32), new THREE.MeshBasicMaterial({ color: '#35c7ff', toneMapped: false }));
          ring.rotation.x = -Math.PI / 2;
          ring.position.y = 0.065;
          g.add(ring);
          add(g, new THREE.BoxGeometry(0.9, 2.2, 0.3), std('#f2f3f5', { roughness: 0.3 }), 0, 1.1, -0.95);
          const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.34), new THREE.MeshBasicMaterial({ color: '#35c7ff', toneMapped: false }));
          screen.position.set(0, 1.55, -0.79);
          g.add(screen);
          break;
        }
        case 'beanbag':
          continue;
      }
      this.group.add(g);
    }
  }

  private buildLabels() {
    for (const room of this.layout.rooms.values()) {
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 96;
      const ctx = canvas.getContext('2d')!;
      ctx.font = '600 56px Inter, system-ui, sans-serif';
      ctx.fillStyle = room.def.kind === 'server' || room.def.kind === 'media' ? 'rgba(255,255,255,0.55)' : 'rgba(40,45,60,0.42)';
      ctx.textBaseline = 'middle';
      ctx.fillText(room.def.name.toUpperCase(), 8, 48);
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      const geo = new THREE.PlaneGeometry(6, 6 * (96 / 512));
      geo.rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
      const door = room.doors[0];
      const inward = door?.side === 'n' ? 1 : -1;
      const x = room.x0 + 0.9 + 3;
      const z = door && (door.side === 'n' || door.side === 's') ? door.z + inward * 0.9 : room.z0 + 1;
      mesh.position.set(x, 0.03, z);
      this.group.add(mesh);
    }
  }
}

/** Abstract painting for an easel canvas. */
function canvasArt(accent: string): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 100;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fbfaf7';
  ctx.fillRect(0, 0, 128, 100);
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(46, 48, 30, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#1a44ff';
  ctx.fillRect(70, 18, 40, 52);
  ctx.strokeStyle = '#ffd23f';
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.moveTo(8, 88);
  ctx.bezierCurveTo(40, 60, 80, 100, 120, 76);
  ctx.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Red "ON AIR" light. */
function onAirTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 72;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ff2d2d';
  ctx.fillRect(0, 0, 256, 72);
  ctx.fillStyle = '#ffffff';
  ctx.font = '800 44px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('ON AIR', 128, 38);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Glowing pink neon lettering on a transparent background. */
function neonTexture(text: string): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.font = 'italic 700 128px "Brush Script MT", "Segoe Script", cursive';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = '#ff3fa4';
  for (const [blur, color] of [[48, '#ff3fa4'], [20, '#ff7cc3'], [0, '#fff0f8']] as const) {
    ctx.shadowBlur = blur;
    ctx.fillStyle = color;
    ctx.fillText(text, 512, 132);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Correction so every model's "front" faces +z at rot 0 (tuned visually). */
const MODEL_YAW: Partial<Record<FurnitureModel, number>> = {};

function boardTexture(kind: Board['kind']): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 176;
  const ctx = c.getContext('2d')!;
  const rand = (() => {
    let s = kind.length * 99;
    return () => ((s = (s * 16807) % 2147483647) / 2147483647);
  })();
  if (kind === 'screen') {
    ctx.fillStyle = '#18202e';
    ctx.fillRect(0, 0, 512, 176);
    ctx.strokeStyle = '#4fc3ff';
    ctx.lineWidth = 4;
    ctx.beginPath();
    for (let x = 0; x <= 512; x += 32) ctx.lineTo(x, 120 - rand() * 80);
    ctx.stroke();
    ctx.fillStyle = '#3ecf8e';
    for (let i = 0; i < 10; i++) ctx.fillRect(20 + i * 48, 150 - rand() * 30, 26, 30);
  } else if (kind === 'moodboard') {
    ctx.fillStyle = '#fbfaf7';
    ctx.fillRect(0, 0, 512, 176);
    const colors = ['#ff8a5b', '#ffd23f', '#9b5de5', '#00bbf9', '#f15bb5', '#3ecf8e'];
    for (let i = 0; i < 14; i++) {
      ctx.fillStyle = colors[i % colors.length];
      ctx.fillRect(rand() * 450, rand() * 130, 40 + rand() * 60, 30 + rand() * 40);
    }
  } else if (kind === 'broadcast') {
    // News graphic: studio backdrop with a lower-third banner.
    const grad = ctx.createLinearGradient(0, 0, 512, 176);
    grad.addColorStop(0, '#0b1d5c');
    grad.addColorStop(1, '#1a44ff');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 512, 176);
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    for (let i = 0; i < 8; i++) {
      ctx.beginPath();
      ctx.arc(380, 60, 20 + i * 18, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = '#ff2d2d';
    ctx.fillRect(0, 118, 150, 40);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(150, 118, 362, 40);
    ctx.font = '800 26px Inter, system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText('LIVE', 44, 139);
    ctx.fillStyle = '#0b1d5c';
    ctx.fillText('UPLANE NEWS', 170, 139);
  } else if (kind === 'storyboard') {
    // Six frames with little sketches and captions.
    ctx.fillStyle = '#fbfaf7';
    ctx.fillRect(0, 0, 512, 176);
    const tints = ['#ffd9c7', '#d6f0e8', '#e3dcff', '#fff0b3', '#cfe0ff', '#ffcfdf'];
    for (let i = 0; i < 6; i++) {
      const x = 14 + (i % 3) * 166;
      const y = 10 + Math.floor(i / 3) * 84;
      ctx.fillStyle = tints[i];
      ctx.fillRect(x, y, 150, 56);
      ctx.strokeStyle = '#2b2f38';
      ctx.lineWidth = 3;
      ctx.strokeRect(x, y, 150, 56);
      ctx.beginPath();
      ctx.arc(x + 40 + rand() * 60, y + 30, 12, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#8a8f99';
      ctx.fillRect(x, y + 62, 60 + rand() * 80, 5);
    }
  } else if (kind === 'kanban') {
    ctx.fillStyle = '#fbfaf7';
    ctx.fillRect(0, 0, 512, 176);
    const cols = ['#ffd23f', '#4fc3ff', '#3ecf8e', '#f15bb5'];
    for (let c2 = 0; c2 < 4; c2++) {
      ctx.fillStyle = '#d8dce3';
      ctx.fillRect(10 + c2 * 126, 10, 116, 6);
      const n = 2 + Math.floor(rand() * 4);
      for (let k = 0; k < n; k++) {
        ctx.fillStyle = cols[c2];
        ctx.fillRect(18 + c2 * 126 + (k % 2) * 52, 26 + Math.floor(k / 2) * 44, 44, 36);
      }
    }
  } else {
    ctx.fillStyle = '#fbfaf7';
    ctx.fillRect(0, 0, 512, 176);
    ctx.strokeStyle = '#4f6bd8';
    ctx.lineWidth = 3;
    for (let i = 0; i < 6; i++) {
      ctx.beginPath();
      ctx.moveTo(30, 30 + i * 22);
      ctx.lineTo(80 + rand() * 300, 30 + i * 22);
      ctx.stroke();
    }
    ctx.strokeStyle = '#e8505b';
    ctx.strokeRect(360, 40, 110, 90);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}


function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const FLOOR_TILE: Record<FloorPattern, number> = { wood: 4, darkwood: 4, concrete: 12, terrazzo: 6, tiles: 3, pavers: 4 };

/** Procedural floor textures so rooms read as wood, concrete, terrazzo, ... */
function floorTexture(pattern: FloorPattern): THREE.Texture {
  const size = 512;
  let seed = pattern.length * 7919;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const tex = canvasTexture(size, size, (ctx) => {
    switch (pattern) {
      case 'wood':
      case 'darkwood': {
        const tones = pattern === 'wood' ? ['#d9b48c', '#d1aa80', '#dfbd97', '#caa177', '#d6b089'] : ['#8a6446', '#7d5a3f', '#946d4d', '#735237'];
        const rows = 8;
        const h = size / rows;
        for (let r = 0; r < rows; r++) {
          let x = -rnd() * 200;
          while (x < size) {
            const len = 140 + rnd() * 220;
            ctx.fillStyle = tones[Math.floor(rnd() * tones.length)];
            ctx.fillRect(x, r * h, len, h);
            ctx.strokeStyle = 'rgba(0,0,0,0.05)';
            for (let k = 0; k < 3; k++) {
              ctx.beginPath();
              const y = r * h + 8 + rnd() * (h - 16);
              ctx.moveTo(x + 6, y);
              ctx.lineTo(x + len - 6, y + (rnd() - 0.5) * 6);
              ctx.stroke();
            }
            ctx.fillStyle = 'rgba(60,40,20,0.35)';
            ctx.fillRect(x, r * h, 2, h);
            x += len;
          }
          ctx.fillStyle = 'rgba(60,40,20,0.3)';
          ctx.fillRect(0, r * h, size, 2);
        }
        break;
      }
      case 'concrete': {
        ctx.fillStyle = '#d9dade';
        ctx.fillRect(0, 0, size, size);
        for (let i = 0; i < 40; i++) {
          ctx.fillStyle = `rgba(${rnd() < 0.5 ? '255,255,255' : '120,125,135'},0.05)`;
          ctx.beginPath();
          ctx.arc(rnd() * size, rnd() * size, 30 + rnd() * 90, 0, Math.PI * 2);
          ctx.fill();
        }
        for (let i = 0; i < 2500; i++) {
          ctx.fillStyle = `rgba(90,95,105,${0.08 + rnd() * 0.12})`;
          ctx.fillRect(rnd() * size, rnd() * size, 1.5, 1.5);
        }
        ctx.strokeStyle = 'rgba(120,125,135,0.25)';
        ctx.lineWidth = 2;
        ctx.strokeRect(0, 0, size, size);
        break;
      }
      case 'terrazzo': {
        ctx.fillStyle = '#f3efe6';
        ctx.fillRect(0, 0, size, size);
        const chips = ['#ff8a5b', '#1a44ff', '#3ecf8e', '#ffb020', '#c9c2b4', '#f15bb5', '#8f96a3'];
        for (let i = 0; i < 520; i++) {
          ctx.fillStyle = chips[Math.floor(rnd() * chips.length)];
          ctx.globalAlpha = 0.55 + rnd() * 0.4;
          const x = rnd() * size;
          const y = rnd() * size;
          const r = 2 + rnd() * 7;
          ctx.beginPath();
          const n = 4 + Math.floor(rnd() * 3);
          for (let k = 0; k < n; k++) {
            const a = (k / n) * Math.PI * 2 + rnd();
            const rr = r * (0.6 + rnd() * 0.6);
            ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
          }
          ctx.fill();
        }
        ctx.globalAlpha = 1;
        break;
      }
      case 'tiles': {
        ctx.fillStyle = '#3d4351';
        ctx.fillRect(0, 0, size, size);
        ctx.strokeStyle = '#2b303b';
        ctx.lineWidth = 6;
        for (let k = 0; k <= 4; k++) {
          ctx.beginPath();
          ctx.moveTo((k * size) / 4, 0);
          ctx.lineTo((k * size) / 4, size);
          ctx.moveTo(0, (k * size) / 4);
          ctx.lineTo(size, (k * size) / 4);
          ctx.stroke();
        }
        ctx.fillStyle = 'rgba(79,195,255,0.18)';
        for (let i = 0; i < 16; i++) ctx.fillRect(((i % 4) * size) / 4 + 50, (Math.floor(i / 4) * size) / 4 + 60, 16, 16);
        break;
      }
      case 'pavers': {
        ctx.fillStyle = '#cfcac0';
        ctx.fillRect(0, 0, size, size);
        const rows = 8;
        const h = size / rows;
        for (let r = 0; r < rows; r++) {
          const off = r % 2 ? h : 0;
          for (let x = -off; x < size; x += h * 2) {
            ctx.fillStyle = ['#d8d3c9', '#cbc6bb', '#d2cdc3'][Math.floor(rnd() * 3)];
            ctx.fillRect(x + 2, r * h + 2, h * 2 - 4, h - 4);
          }
        }
        break;
      }
    }
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

function rugTexture(): THREE.Texture {
  return canvasTexture(256, 256, (ctx) => {
    const r = 36;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.roundRect(4, 4, 248, 248, r);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.12)';
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.roundRect(22, 22, 212, 212, r - 14);
    ctx.stroke();
  });
}

let logoImage: HTMLImageElement | null = null;

/** Load the Uplane wordmark (SVG) once before building the office. */
export async function loadLogo(url: string): Promise<void> {
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
    logoImage = img;
  } catch {
    logoImage = null;
  }
}

/** Uplane wordmark in `fg` on a `bg` background (falls back to text). */
function logoTexture(bg: string, fg: string, w: number, h: number): THREE.Texture {
  return canvasTexture(w, h, (ctx) => {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    if (logoImage) {
      // Recolour the black SVG via an offscreen canvas, then centre it.
      const lh = h * 0.62;
      const lw = (logoImage.naturalWidth / logoImage.naturalHeight) * lh;
      const off = document.createElement('canvas');
      off.width = Math.ceil(lw);
      off.height = Math.ceil(lh);
      const o = off.getContext('2d')!;
      o.drawImage(logoImage, 0, 0, lw, lh);
      o.globalCompositeOperation = 'source-in';
      o.fillStyle = fg;
      o.fillRect(0, 0, lw, lh);
      ctx.drawImage(off, (w - lw) / 2, (h - lh) / 2);
      return;
    }
    ctx.fillStyle = fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `500 ${Math.round(h * 0.62)}px "Lab Grotesque", "Helvetica Neue", Arial, sans-serif`;
    ctx.fillText('uplane', w / 2, h / 2);
  });
}
