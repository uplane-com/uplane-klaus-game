import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { CHARACTER_SCALE } from '../config/scale';
import { Rng } from '../util/rng';
import { loadGLTF } from './assets';

/**
 * Character creation with per-agent variety. Every look is derived from the
 * agent id, so the same agent always looks the same:
 *  - one of 12 base characters (Kenney Mini Characters, CC0)
 *  - clothing hue shift + trouser tint (palette-aware shader tweak)
 *  - height / build variation
 *  - accessories: glasses, sunglasses, hearing aid, headphones
 */

const BASES = ['a', 'b', 'c', 'd', 'e', 'f'].flatMap((l) => [`character-female-${l}`, `character-male-${l}`]);

export type AnimName = 'idle' | 'walk' | 'sit' | 'interact-right' | 'emote-yes' | 'emote-no' | 'pick-up' | 'holding-right';
const ANIMS: AnimName[] = ['idle', 'walk', 'sit', 'interact-right', 'emote-yes', 'emote-no', 'pick-up', 'holding-right'];

/** Units/second the walk clip was authored for (at timeScale 1, world scale). */
const WALK_CLIP_SPEED = 1.5;

const PANTS_TINTS = [
  [1, 1, 1],
  [0.55, 0.68, 1.0],
  [0.5, 0.5, 0.58],
  [1.0, 0.9, 0.66],
  [0.75, 0.86, 0.62],
  [0.95, 0.62, 0.66],
  [0.62, 0.55, 0.5],
];

const HEADPHONE_COLORS = ['#222831', '#f5f5f5', '#ff5c5c', '#4f9dff', '#ffd23f', '#9b5de5'];

interface Accessories {
  glasses: THREE.Object3D;
  sunglasses: THREE.Object3D;
  hearing: THREE.Object3D;
}

export class CharacterLibrary {
  private constructor(
    private readonly bases: THREE.Object3D[],
    private readonly clips: Map<string, THREE.AnimationClip>,
    private readonly acc: Accessories,
  ) {}

  static async load(): Promise<CharacterLibrary> {
    const gltfs = await Promise.all(BASES.map((b) => loadGLTF(`models/characters/${b}.glb`)));
    const clips = new Map<string, THREE.AnimationClip>();
    for (const clip of gltfs[0].animations) clips.set(clip.name, clip);
    for (const g of gltfs) {
      mergeSkinnedParts(g.scene);
      g.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.castShadow = true;
          m.frustumCulled = false;
        }
      });
    }
    const [glasses, sunglasses, hearing] = await Promise.all(
      ['aid-glasses', 'aid-sunglasses', 'aid_hearing'].map(async (n) => (await loadGLTF(`models/characters/${n}.glb`)).scene),
    );
    return new CharacterLibrary(
      gltfs.map((g) => g.scene),
      clips,
      { glasses, sunglasses, hearing },
    );
  }

  create(id: string): Character {
    return new Character(id, this.bases, this.clips, this.acc);
  }

  /** Security guard: police-cap character, dark uniform, sunglasses. */
  createGuard(id: string): Character {
    return new Character(id, this.bases, this.clips, this.acc, { base: BASES.indexOf('character-male-c'), hue: 0, pants: [0.45, 0.45, 0.55], sunglasses: true });
  }

  /** Facility staff (janitor, cleaner) with a fixed look. */
  createStaff(id: string, base: string, hue: number, pants: number[]): Character {
    const c = new Character(id, this.bases, this.clips, this.acc, { base: BASES.indexOf(base), hue, pants });
    c.smooth = true; // few of them, always animate at full rate
    return c;
  }

  /** Server-room operator on permanent watch. */
  createOperator(): Character {
    return new Character('noc-operator', this.bases, this.clips, this.acc, { base: BASES.indexOf('character-male-b'), hue: 3.9, pants: [0.3, 0.3, 0.36] });
  }

  /** Front-desk staff: fixed female characters so the reception always looks the same. */
  createReceptionist(index: number): Character {
    const base = BASES.indexOf(index % 2 ? 'character-female-d' : 'character-female-a');
    return new Character(`reception-${index}`, this.bases, this.clips, this.acc, { base, hue: index % 2 ? 2.4 : 0, pants: [0.35, 0.35, 0.42] });
  }
}

/**
 * Kenney characters are split into body + head skinned meshes bound to the
 * same bones. Merging them halves the draw calls per agent.
 */
function mergeSkinnedParts(scene: THREE.Object3D) {
  const parts: THREE.SkinnedMesh[] = [];
  scene.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) parts.push(o as THREE.SkinnedMesh);
  });
  if (parts.length < 2) return;
  const [first] = parts;
  const sameBones = parts.every(
    (p) => p.skeleton.bones.length === first.skeleton.bones.length && p.skeleton.bones.every((b, i) => b === first.skeleton.bones[i]),
  );
  const sameMaterial = parts.every((p) => p.material === first.material);
  if (!sameBones || !sameMaterial) return;
  const merged = mergeGeometries(parts.map((p) => p.geometry));
  if (!merged) return;
  const mesh = new THREE.SkinnedMesh(merged, first.material);
  mesh.name = 'character-mesh';
  first.parent!.add(mesh);
  mesh.bind(first.skeleton, first.bindMatrix);
  for (const p of parts) p.removeFromParent();
}

export interface Pose {
  seated?: boolean;
  /** Seated with a laptop on the lap (sofa/beanbag workstation). */
  lap?: boolean;
  /** On the phone: hand at the ear, the other hand talking. */
  phone?: boolean;
  /** Hands on handlebars. */
  ride?: boolean;
  typing?: boolean;
  thinking?: boolean;
  handUp?: boolean;
  shake?: boolean;
  /**
   * Two-handed work motions blended over the clip: `weight` 0..1 eases the pose
   * in/out, `swing` -1..1 is the current phase of the stroke.
   */
  sweep?: { weight: number; swing: number };
  wipe?: { weight: number; swing: number };
}

/** Laptop position relative to a seated character's root (world units). */
const LAP_HEIGHT = 0.42;
const LAP_FORWARD = 0.42;

const armEuler = new THREE.Euler(0, 0, 0, 'YZX');
const tmpQuat = new THREE.Quaternion();

/** Like setArm, but blends towards the target pose by `w` (0 = keep current). */
function blendArm(bone: THREE.Bone, side: 1 | -1, forward: number, drop: number, w: number) {
  armEuler.set(0, -side * forward, -side * drop);
  tmpQuat.setFromEuler(armEuler);
  bone.quaternion.slerp(tmpQuat, w);
}
/**
 * Pose an arm from the rig's T-pose rest: `forward` swings it from sideways
 * to pointing ahead, `drop` lowers (positive) or raises (negative) the hand.
 * side: 1 = left arm, -1 = right arm.
 */
function setArm(bone: THREE.Bone, side: 1 | -1, forward: number, drop: number) {
  armEuler.set(0, -side * forward, -side * drop);
  bone.quaternion.setFromEuler(armEuler);
}

// Shared resources for procedural bits.
/** Headband + two ear cups merged into one geometry (one draw call). */
const headphonesGeo = (() => {
  const band = new THREE.TorusGeometry(0.245, 0.022, 6, 16, Math.PI);
  band.scale(1, 1.05, 1);
  band.translate(0, 0.17, 0);
  const cupL = new THREE.BoxGeometry(0.06, 0.12, 0.12).translate(0.245, 0.14, 0);
  const cupR = new THREE.BoxGeometry(0.06, 0.12, 0.12).translate(-0.245, 0.14, 0);
  return mergeGeometries([band.toNonIndexed(), cupL.toNonIndexed(), cupR.toNonIndexed()])!;
})();
/** Laptop resting on the lap: base + open lid, screen facing the character. */
const laptopGeo = (() => {
  const base = new THREE.BoxGeometry(0.54, 0.03, 0.36).translate(0, 0.015, 0);
  const lid = new THREE.BoxGeometry(0.54, 0.34, 0.025).translate(0, 0.17, 0).rotateX(0.3).translate(0, 0.02, 0.18);
  return mergeGeometries([base.toNonIndexed(), lid.toNonIndexed()])!;
})();
const laptopScreenGeo = new THREE.PlaneGeometry(0.48, 0.28).rotateY(Math.PI).translate(0, 0.17, -0.014).rotateX(0.3).translate(0, 0.02, 0.18);
const laptopMat = new THREE.MeshStandardMaterial({ color: '#3a3f4b', roughness: 0.4, metalness: 0.3 });
const screenOn = new THREE.MeshBasicMaterial({ color: '#9fd4ff', toneMapped: false });
const screenOff = new THREE.MeshBasicMaterial({ color: '#2b3140' });

const materialCache = new Map<string, THREE.MeshStandardMaterial>();
function flatMat(color: string) {
  let m = materialCache.get(color);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: 0.6 });
    materialCache.set(color, m);
  }
  return m;
}

function tintMaterial(src: THREE.MeshStandardMaterial, hue: number, pants: number[]) {
  const mat = src.clone();
  const uniforms = {
    uHue: { value: hue },
    uPants: { value: new THREE.Vector3(...pants) },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uHue;
        uniform vec3 uPants;
        vec3 hueRotate(vec3 c, float a) {
          const vec3 k = vec3(0.57735);
          float ca = cos(a);
          return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
        }`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        #ifdef USE_MAP
        {
          // Kenney palette: 8 columns x 4 rows of 64x128px swatches.
          float col = floor(vMapUv.x * 8.0);
          float row = floor(vMapUv.y * 4.0);
          bool cloth = (row == 2.0 && col >= 1.0 && col != 3.0) || (row == 1.0 && col == 0.0);
          if (cloth) diffuseColor.rgb = max(hueRotate(diffuseColor.rgb, uHue), vec3(0.0));
          bool trousers = row == 3.0 && col >= 1.0 && col <= 3.0;
          if (trousers) diffuseColor.rgb *= uPants;
        }
        #endif`,
      );
  };
  mat.customProgramCacheKey = () => 'agent-tint';
  mat.userData.uniforms = uniforms;
  return mat;
}

export class Character {
  /** Move/rotate this. */
  readonly root = new THREE.Group();
  readonly mixer: THREE.AnimationMixer;
  private readonly model: THREE.Object3D;
  private readonly actions = new Map<AnimName, THREE.AnimationAction>();
  private current: AnimName | null = null;
  private readonly materials: THREE.Material[] = [];
  private readonly bones: Record<'armL' | 'armR' | 'head' | 'torso', THREE.Bone>;
  /** Rest rotations; not every clip animates every bone, so we reset before layering. */
  private readonly rest: [THREE.Bone, THREE.Quaternion][];
  readonly walkFactor: number;
  private readonly phase: number;
  private opacity = 1;
  private laptop: { group: THREE.Group; screen: THREE.Mesh } | null = null;

  constructor(
    id: string,
    bases: THREE.Object3D[],
    clips: Map<string, THREE.AnimationClip>,
    acc: Accessories,
    look: { base?: number; hue?: number; pants?: number[]; sunglasses?: boolean } = {},
  ) {
    const rng = new Rng(id);
    const base = bases[look.base ?? rng.int(0, bases.length - 1)];
    this.model = SkeletonUtils.clone(base);
    const height = rng.float(0.93, 1.07);
    const build = rng.float(0.94, 1.08);
    this.model.scale.set(CHARACTER_SCALE * build, CHARACTER_SCALE * height, CHARACTER_SCALE * build);
    this.root.add(this.model);
    this.phase = rng.float(0, 100);
    this.walkFactor = rng.float(0.9, 1.12);

    const hue = look.hue ?? (rng.chance(0.2) ? 0 : rng.float(0, Math.PI * 2));
    const pants = look.pants ?? rng.pick(PANTS_TINTS);
    let sharedTint: THREE.Material | null = null;
    this.model.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (!m.isMesh) return;
      if (!sharedTint) {
        sharedTint = tintMaterial(m.material as THREE.MeshStandardMaterial, hue, pants);
        this.materials.push(sharedTint);
      }
      m.material = sharedTint;
    });

    const find = (name: string) => this.model.getObjectByName(name) as THREE.Bone;
    this.bones = { armL: find('arm-left'), armR: find('arm-right'), head: find('head'), torso: find('torso') };
    this.rest = Object.values(this.bones).map((b) => [b, b.quaternion.clone()]);

    // Accessories (positions are in unscaled model units relative to the head bone).
    const accMat = (sharedTint! as THREE.MeshStandardMaterial).clone();
    accMat.onBeforeCompile = () => {};
    this.materials.push(accMat);
    const attach = (src: THREE.Object3D, x: number, y: number, z: number) => {
      const obj = src.clone();
      obj.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) mesh.material = accMat;
      });
      obj.position.set(x, y, z);
      this.bones.head.add(obj);
    };
    const r = look.sunglasses ? 0.25 : rng.float();
    if (r < 0.2) attach(acc.glasses, 0, 0.1, 0.09);
    else if (r < 0.3) attach(acc.sunglasses, 0, 0.1, 0.09);
    if (rng.chance(0.07)) attach(acc.hearing, -0.235, 0.08, -0.02);
    if (!look.sunglasses && rng.chance(0.2)) this.bones.head.add(new THREE.Mesh(headphonesGeo, flatMat(rng.pick(HEADPHONE_COLORS))));

    this.mixer = new THREE.AnimationMixer(this.model);
    for (const name of ANIMS) {
      const clip = clips.get(name);
      if (clip) this.actions.set(name, this.mixer.clipAction(clip));
    }
    this.play('idle', 0);
    this.mixer.update(this.phase);
  }

  play(name: AnimName, fade = 0.25, timeScale = 1) {
    const next = this.actions.get(name);
    if (!next) return;
    next.timeScale = timeScale;
    if (this.current === name) return;
    const prev = this.current ? this.actions.get(this.current) : undefined;
    next.reset().play();
    if (prev && fade > 0) next.crossFadeFrom(prev, fade, false);
    else if (prev) prev.stop();
    this.current = name;
  }

  get anim() {
    return this.current;
  }

  setWalkSpeed(speed: number) {
    const walk = this.actions.get('walk');
    if (walk) walk.timeScale = Math.max(0.3, speed / WALK_CLIP_SPEED);
  }

  /** Procedural layers on top of the clips. */
  /** Advance skeletons only every N frames (low quality); staggered per character. */
  static animEvery = 1;
  /** Opt out of the reduced animation rate (staff, few characters). */
  smooth = false;
  private animFrame = 0;
  private animDt = 0;

  update(dt: number, pose: Pose, t: number) {
    this.animDt += dt;
    if (!this.smooth && Character.animEvery > 1 && (this.animFrame++ + Math.floor(this.phase)) % Character.animEvery !== 0) return;
    dt = this.animDt;
    this.animDt = 0;
    for (const [bone, q] of this.rest) bone.quaternion.copy(q);
    this.mixer.update(dt);
    const tt = t + this.phase;
    if (pose.seated) {
      // Relaxed hands on the desk/lap; activity poses below override this.
      setArm(this.bones.armL, 1, 1.15, 0.75);
      setArm(this.bones.armR, -1, 1.15, 0.75);
    }
    if (pose.ride) {
      setArm(this.bones.armL, 1, 1.35, 0.2);
      setArm(this.bones.armR, -1, 1.35, 0.2);
    }
    this.showLaptop(!!pose.lap, !!pose.typing);
    if (pose.lap) {
      // Hands resting on the laptop keyboard, head tilted down to the screen.
      const k = pose.typing ? 0.06 : 0;
      setArm(this.bones.armL, 1, 1.2, 0.62 + Math.sin(tt * 16) * k);
      setArm(this.bones.armR, -1, 1.2, 0.62 + Math.sin(tt * 16 + 1.7) * k);
      this.bones.head.rotateX(0.22);
    } else if (pose.typing) {
      setArm(this.bones.armL, 1, 1.3, 0.3 + Math.sin(tt * 16) * 0.08);
      setArm(this.bones.armR, -1, 1.3, 0.3 + Math.sin(tt * 16 + 1.7) * 0.08);
      this.bones.head.rotateX(0.12);
    }
    if (pose.thinking) {
      setArm(this.bones.armR, -1, 1.25, -0.55);
      this.bones.head.rotateZ(Math.sin(tt * 1.3) * 0.12);
    }
    if (pose.phone) {
      setArm(this.bones.armR, -1, 0.95, -0.8);
      setArm(this.bones.armL, 1, 1.1 + Math.sin(tt * 2.3) * 0.25, 0.45 + Math.sin(tt * 3.1) * 0.15);
      this.bones.head.rotateZ(-0.18);
      this.bones.head.rotateY(Math.sin(tt * 0.9) * 0.2);
    }
    if (pose.handUp) {
      // Chibi arms cannot reach above the head, so wave beside it instead.
      setArm(this.bones.armR, -1, 0.25, -0.75 + Math.sin(tt * 7) * 0.3);
    }
    if (pose.shake) {
      this.bones.head.rotateY(Math.sin(tt * 18) * 0.35);
    }
    if (pose.sweep && pose.sweep.weight > 0.001) {
      // Mopping: both hands low in front on the handle, body turning with each stroke.
      const { weight: w, swing: s } = pose.sweep;
      blendArm(this.bones.armL, 1, 1.05 + s * 0.2, 0.62, w);
      blendArm(this.bones.armR, -1, 1.2 - s * 0.2, 0.78, w);
      this.bones.torso.rotateY(s * 0.22 * w);
      this.bones.head.rotateY(-s * 0.12 * w);
      this.bones.head.rotateX(0.18 * w);
    }
    if (pose.wipe && pose.wipe.weight > 0.001) {
      // Wiping the cart: left hand on the handle, right hand making slow circles.
      const { weight: w, swing: s } = pose.wipe;
      blendArm(this.bones.armL, 1, 1.3, 0.3, w);
      blendArm(this.bones.armR, -1, 1.3 + s * 0.18, 0.42 + Math.cos(tt * 2.2) * 0.08, w);
      this.bones.torso.rotateY(s * 0.08 * w);
      this.bones.head.rotateX(0.22 * w);
    }
  }

  private showLaptop(on: boolean, active: boolean) {
    if (!on && !this.laptop) return;
    if (!this.laptop) {
      const group = new THREE.Group();
      const body = new THREE.Mesh(laptopGeo, laptopMat);
      body.castShadow = true;
      const screen = new THREE.Mesh(laptopScreenGeo, screenOff);
      group.add(body, screen);
      group.position.set(0, LAP_HEIGHT, LAP_FORWARD);
      this.root.add(group);
      this.laptop = { group, screen };
    }
    this.laptop.group.visible = on;
    this.laptop.screen.material = active ? screenOn : screenOff;
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
    this.mixer.stopAllAction();
    for (const m of this.materials) m.dispose();
    this.root.removeFromParent();
  }
}
