import * as THREE from 'three';
import type { AnimName, Pose } from './characters';

/**
 * A sleek humanoid robot (think Optimus): glossy white shell, black joints and
 * a black visor face. Fully procedural and animated in code, but it exposes the
 * same puppet API as the Kenney characters so a Body can walk it through the crowd.
 */
export class RobotPuppet {
  readonly root = new THREE.Group();
  readonly walkFactor = 0.85;
  private readonly materials: THREE.MeshStandardMaterial[] = [];
  private readonly parts: {
    hips: THREE.Group;
    torso: THREE.Group;
    head: THREE.Group;
    legL: THREE.Group;
    legR: THREE.Group;
    kneeL: THREE.Group;
    kneeR: THREE.Group;
    armL: THREE.Group;
    armR: THREE.Group;
    elbowL: THREE.Group;
    elbowR: THREE.Group;
    visor: THREE.MeshStandardMaterial;
  };
  private anim: AnimName = 'idle';
  private cadence = 1;
  private cycle = 0;
  private opacity = 1;

  constructor() {
    const shell = this.mat('#f2f3f5', { roughness: 0.25, metalness: 0.1 });
    const joint = this.mat('#15171c', { roughness: 0.35, metalness: 0.4 });
    const visor = this.mat('#05060a', { roughness: 0.05, metalness: 0.6, emissive: '#1a44ff', emissiveIntensity: 0.25 });
    const add = (parent: THREE.Object3D, geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      parent.add(mesh);
      return mesh;
    };
    const pivot = (parent: THREE.Object3D, x: number, y: number, z: number) => {
      const g = new THREE.Group();
      g.position.set(x, y, z);
      parent.add(g);
      return g;
    };
    const capsule = (r: number, len: number) => new THREE.CapsuleGeometry(r, len, 4, 10);

    const hips = pivot(this.root, 0, 0.98, 0);
    add(hips, new THREE.BoxGeometry(0.36, 0.16, 0.2), joint, 0, 0, 0);

    // Legs: thigh → knee → shin + foot. Pivots at the hip joints.
    const leg = (side: 1 | -1) => {
      const hip = pivot(hips, side * 0.11, -0.04, 0);
      add(hip, new THREE.SphereGeometry(0.075, 10, 8), joint, 0, 0, 0);
      add(hip, capsule(0.075, 0.28), shell, 0, -0.22, 0);
      const knee = pivot(hip, 0, -0.44, 0);
      add(knee, new THREE.SphereGeometry(0.06, 10, 8), joint, 0, 0, 0);
      add(knee, capsule(0.06, 0.3), shell, 0, -0.22, 0);
      add(knee, new THREE.BoxGeometry(0.11, 0.06, 0.22), joint, 0, -0.47, 0.04);
      return { hip, knee };
    };
    const l = leg(1);
    const r = leg(-1);

    // Torso with a sculpted chest plate.
    const torso = pivot(hips, 0, 0.08, 0);
    add(torso, new THREE.CylinderGeometry(0.13, 0.15, 0.2, 12), joint, 0, 0.1, 0);
    const chest = add(torso, new THREE.CapsuleGeometry(0.19, 0.22, 4, 12), shell, 0, 0.38, 0);
    chest.scale.set(1.15, 1, 0.72);
    add(torso, new THREE.BoxGeometry(0.2, 0.02, 0.01), this.mat('#1a44ff', { emissive: '#1a44ff', emissiveIntensity: 0.8 }), 0, 0.46, 0.145);
    add(torso, new THREE.CylinderGeometry(0.05, 0.06, 0.08, 10), joint, 0, 0.66, 0);

    // Head: white helmet with a black glossy face visor (sphere segment centred on +z = front).
    const head = pivot(torso, 0, 0.8, 0);
    const skull = add(head, new THREE.SphereGeometry(0.14, 16, 12), shell, 0, 0, 0);
    skull.scale.set(0.95, 1.1, 1);
    const face = add(head, new THREE.SphereGeometry(0.128, 16, 12, Math.PI / 2 - Math.PI / 2.4, Math.PI / 1.2, Math.PI / 4, Math.PI / 2.1), visor, 0, -0.005, 0.02);
    face.scale.set(0.97, 1.08, 1);

    // Arms: shoulder → elbow → forearm + hand.
    const arm = (side: 1 | -1) => {
      const shoulder = pivot(torso, side * 0.27, 0.53, 0);
      add(shoulder, new THREE.SphereGeometry(0.075, 10, 8), joint, 0, 0, 0);
      add(shoulder, capsule(0.055, 0.2), shell, 0, -0.17, 0);
      const elbow = pivot(shoulder, 0, -0.34, 0);
      add(elbow, new THREE.SphereGeometry(0.048, 10, 8), joint, 0, 0, 0);
      add(elbow, capsule(0.048, 0.2), shell, 0, -0.16, 0);
      add(elbow, new THREE.BoxGeometry(0.07, 0.11, 0.05), joint, 0, -0.34, 0);
      return { shoulder, elbow };
    };
    const al = arm(1);
    const ar = arm(-1);

    this.parts = { hips, torso, head, legL: l.hip, legR: r.hip, kneeL: l.knee, kneeR: r.knee, armL: al.shoulder, armR: ar.shoulder, elbowL: al.elbow, elbowR: ar.elbow, visor };
  }

  private mat(color: string, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) {
    const m = new THREE.MeshStandardMaterial({ color, ...extra });
    this.materials.push(m);
    return m;
  }

  play(name: AnimName, _fade = 0.25, timeScale = 1) {
    this.anim = name;
    if (name === 'walk') this.cadence = timeScale;
  }

  setWalkSpeed(speed: number) {
    this.cadence = Math.max(0.4, speed / 1.6);
  }

  update(dt: number, _pose: Pose, t: number) {
    const p = this.parts;
    const walking = this.anim === 'walk';
    if (walking) this.cycle += dt * this.cadence * 5.2;
    const s = Math.sin(this.cycle);
    const k = (target: number, cur: number, rate = 10) => cur + (target - cur) * Math.min(1, dt * rate);

    // Legs + arms swing in opposition while walking; a very slight, controlled bob.
    const stride = walking ? 0.5 : 0;
    p.legL.rotation.x = k(stride * s, p.legL.rotation.x);
    p.legR.rotation.x = k(-stride * s, p.legR.rotation.x);
    p.kneeL.rotation.x = k(walking ? Math.max(0, -Math.cos(this.cycle)) * 0.7 : 0, p.kneeL.rotation.x);
    p.kneeR.rotation.x = k(walking ? Math.max(0, Math.cos(this.cycle)) * 0.7 : 0, p.kneeR.rotation.x);
    p.hips.position.y = 0.98 + (walking ? Math.abs(Math.cos(this.cycle)) * 0.025 : Math.sin(t * 1.5) * 0.004);

    const wave = this.anim === 'interact-right' || this.anim === 'emote-yes';
    p.armL.rotation.x = k(walking ? -stride * s * 0.8 : 0, p.armL.rotation.x);
    p.armR.rotation.x = k(wave ? -2.4 : walking ? stride * s * 0.8 : 0, p.armR.rotation.x);
    p.armR.rotation.z = k(wave ? -0.35 + Math.sin(t * 7) * 0.25 : 0, p.armR.rotation.z);
    p.elbowL.rotation.x = k(-0.25, p.elbowL.rotation.x);
    p.elbowR.rotation.x = k(wave ? -0.6 : -0.25, p.elbowR.rotation.x);

    // Idle: scan the room with the head, visor pulses softly.
    p.head.rotation.y = k(walking ? 0 : Math.sin(t * 0.6) * 0.7, p.head.rotation.y, 4);
    p.torso.rotation.y = walking ? -s * 0.08 : 0;
    p.visor.emissiveIntensity = 0.2 + (Math.sin(t * 2.2) * 0.5 + 0.5) * 0.35;
  }

  setOpacity(o: number) {
    if (Math.abs(o - this.opacity) < 1e-3) return;
    this.opacity = o;
    for (const m of this.materials) {
      m.transparent = o < 1;
      m.opacity = o;
      m.depthWrite = o >= 1;
    }
  }

  dispose() {
    this.root.removeFromParent();
    this.root.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    for (const m of this.materials) m.dispose();
  }
}
