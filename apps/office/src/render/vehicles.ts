import * as THREE from 'three';
import { VEHICLE_SCALE } from '../config/transport';
import { Rng } from '../util/rng';
import { loadGLTF } from './assets';

/** Bus door positions along the body (local z, front = +z). */
export const BUS_DOORS = [3.4, 0.3, -3.1];

/**
 * Vehicle meshes. Cars are Kenney Car Kit models (CC0); bus, bikes, scooters
 * and the helicopter are built from primitives. Every vehicle faces +z in its
 * local space and has its origin on the ground at its centre.
 */

const CAR_MODELS = ['sedan', 'taxi', 'suv', 'van', 'hatchback-sports', 'suv-luxury', 'sedan-sports', 'delivery', 'police'];
const CAR_WEIGHTS = [5, 2, 4, 2, 2, 2, 2, 1, 0.4];

export interface VehicleMesh {
  root: THREE.Group;
  /** Meshes that spin with forward motion (radius in world units). */
  wheels: { obj: THREE.Object3D; radius: number }[];
  /** Half the vehicle length (for spacing in traffic). */
  halfLength: number;
  /** Half the vehicle width (to know whether two vehicles overlap sideways). */
  halfWidth: number;
  /** Spinning fans/rotors (helicopter). */
  rotors?: THREE.Object3D[];
  dispose(): void;
}

const mats = new Map<string, THREE.MeshStandardMaterial>();
function mat(color: string, opts: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  const key = color + JSON.stringify(opts);
  let m = mats.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...opts });
    mats.set(key, m);
  }
  return m;
}

function box(w: number, h: number, d: number, color: string, x = 0, y = 0, z = 0, opts?: Partial<THREE.MeshStandardMaterialParameters>) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, opts));
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

function wheel(radius: number, width: number, color = '#22252b') {
  const g = new THREE.CylinderGeometry(radius, radius, width, 14);
  g.rotateZ(Math.PI / 2);
  const m = new THREE.Mesh(g, mat(color));
  m.castShadow = true;
  return m;
}

function disposeTree(root: THREE.Object3D, keepGeometry: boolean) {
  root.removeFromParent();
  if (keepGeometry) return;
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) m.geometry.dispose();
  });
}

const PAINT_BUCKETS = 10;
const paintCache = new Map<string, THREE.Material>();

/** Hue-rotated copy of a Kenney palette material; greys/black (tyres, glass) are barely affected. */
function paint(src: THREE.MeshStandardMaterial, bucket: number): THREE.Material {
  const key = `${src.uuid}:${bucket}`;
  let m = paintCache.get(key);
  if (m) return m;
  const hue = (bucket / PAINT_BUCKETS) * Math.PI * 2;
  const mat = src.clone();
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uHue = { value: hue };
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uHue;
        vec3 hueRotate(vec3 c, float a) {
          const vec3 k = vec3(0.57735);
          float ca = cos(a);
          return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
        }`,
      )
      .replace('#include <map_fragment>', '#include <map_fragment>\n diffuseColor.rgb = max(hueRotate(diffuseColor.rgb, uHue), vec3(0.0));');
  };
  mat.customProgramCacheKey = () => `car-paint-${bucket}`;
  paintCache.set(key, mat);
  return mat;
}

export class VehicleFactory {
  private constructor(private readonly cars: THREE.Object3D[]) {}

  static async load(): Promise<VehicleFactory> {
    const scenes = await Promise.all(CAR_MODELS.map(async (m) => (await loadGLTF(`models/vehicles/${m}.glb`)).scene));
    for (const s of scenes) {
      s.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.castShadow = true;
      });
    }
    return new VehicleFactory(scenes);
  }

  car(seed: string): VehicleMesh {
    const rng = new Rng(seed);
    const idx = CAR_MODELS.indexOf(rng.weighted(CAR_MODELS, (m) => CAR_WEIGHTS[CAR_MODELS.indexOf(m)]));
    const model = this.cars[idx].clone();
    model.scale.setScalar(VEHICLE_SCALE);
    // Taxis and police cars keep their livery; everything else gets a random paint job.
    const name = CAR_MODELS[idx];
    if (name !== 'taxi' && name !== 'police') {
      const hueBucket = rng.int(0, PAINT_BUCKETS - 1);
      model.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh && !/^wheel-/.test(o.name)) m.material = paint(m.material as THREE.MeshStandardMaterial, hueBucket);
      });
    }
    const root = new THREE.Group();
    root.add(model);
    const wheels: VehicleMesh['wheels'] = [];
    // Only the four road wheels spin (the SUV also has a spare tyre called "wheel-back").
    model.traverse((o) => {
      if (/^wheel-(front|back)-(left|right)$/.test(o.name)) wheels.push({ obj: o, radius: 0.3 * VEHICLE_SCALE });
    });
    const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
    return { root, wheels, halfLength: size.z / 2, halfWidth: size.x / 2, dispose: () => disposeTree(root, true) };
  }

  bus(livery = '#1a44ff'): VehicleMesh {
    const root = new THREE.Group();
    const L = 10;
    const W = 2.6;
    const blue = livery;
    root.add(box(W, 2.5, L, blue, 0, 1.55, 0));
    root.add(box(W + 0.02, 0.2, L - 0.4, '#ffffff', 0, 2.72, 0));
    // Window band on both sides + windshield.
    root.add(box(W + 0.04, 0.95, L - 2.2, '#1d2433', 0, 2.0, -0.4, { roughness: 0.2, metalness: 0.3 }));
    root.add(box(W - 0.3, 1.1, 0.06, '#1d2433', 0, 2.0, L / 2 + 0.01, { roughness: 0.2, metalness: 0.3 }));
    // Doors on the right-hand (curb) side = local -x; right-hand traffic.
    for (const z of BUS_DOORS) root.add(box(0.06, 1.8, 1.1, '#cdd6ff', -W / 2 - 0.02, 1.25, z));
    // Destination sign.
    const sign = document.createElement('canvas');
    sign.width = 256;
    sign.height = 48;
    const ctx = sign.getContext('2d')!;
    ctx.fillStyle = '#10131a';
    ctx.fillRect(0, 0, 256, 48);
    ctx.fillStyle = '#ffb020';
    ctx.font = 'bold 30px monospace';
    ctx.fillText('UPLANE HQ', 36, 34);
    const tex = new THREE.CanvasTexture(sign);
    tex.colorSpace = THREE.SRGBColorSpace;
    const signMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.34), new THREE.MeshBasicMaterial({ map: tex }));
    signMesh.position.set(0, 2.75, L / 2 + 0.02);
    root.add(signMesh);
    const wheels: VehicleMesh['wheels'] = [];
    for (const z of [-L / 2 + 1.6, L / 2 - 1.8]) {
      for (const x of [-W / 2, W / 2]) {
        const w = wheel(0.55, 0.35);
        w.position.set(x, 0.55, z);
        root.add(w);
        wheels.push({ obj: w, radius: 0.55 });
      }
    }
    return {
      root,
      wheels,
      halfLength: L / 2,
      halfWidth: W / 2,
      dispose: () => {
        disposeTree(root, false);
        tex.dispose();
      },
    };
  }

  bike(color: string): VehicleMesh {
    const root = new THREE.Group();
    const wheels: VehicleMesh['wheels'] = [];
    const r = 0.36;
    for (const z of [-0.55, 0.55]) {
      const t = new THREE.Mesh(new THREE.TorusGeometry(r, 0.045, 6, 18), mat('#1f2126'));
      t.rotation.y = Math.PI / 2;
      t.position.set(0, r, z);
      t.castShadow = true;
      root.add(t);
      wheels.push({ obj: t, radius: r });
    }
    // Frame, seat post, handlebar.
    const frame = box(0.06, 0.06, 1.0, color, 0, 0.62, 0);
    frame.rotation.x = -0.12;
    root.add(frame);
    root.add(box(0.06, 0.45, 0.06, color, 0, 0.62, -0.25));
    root.add(box(0.18, 0.05, 0.28, '#1f2126', 0, 0.86, -0.28));
    root.add(box(0.06, 0.5, 0.06, color, 0, 0.7, 0.45));
    root.add(box(0.5, 0.05, 0.05, '#1f2126', 0, 0.95, 0.45));
    return { root, wheels, halfLength: 0.9, halfWidth: 0.3, dispose: () => disposeTree(root, false) };
  }

  scooter(color: string): VehicleMesh {
    const root = new THREE.Group();
    const wheels: VehicleMesh['wheels'] = [];
    for (const z of [-0.45, 0.45]) {
      const w = wheel(0.12, 0.08);
      w.position.set(0, 0.12, z);
      root.add(w);
      wheels.push({ obj: w, radius: 0.12 });
    }
    root.add(box(0.26, 0.07, 1.0, color, 0, 0.2, 0));
    const stem = box(0.06, 1.0, 0.06, '#2a2d34', 0, 0.7, 0.48);
    stem.rotation.x = 0.12;
    root.add(stem);
    root.add(box(0.46, 0.05, 0.05, '#2a2d34', 0, 1.2, 0.54));
    return { root, wheels, halfLength: 0.6, halfWidth: 0.25, dispose: () => disposeTree(root, false) };
  }

  /**
   * Futuristic eVTOL air taxi: pearl-white capsule body, wraparound glass
   * canopy, glowing light strips and two ducted fans on swept stub wings.
   */
  helicopter(accent = '#1a44ff'): VehicleMesh {
    const root = new THREE.Group();
    const pearl = mat('#f3f5f8', { roughness: 0.25, metalness: 0.15 });
    const charcoal = mat('#2c323c', { roughness: 0.4, metalness: 0.3 });
    const glow = new THREE.MeshBasicMaterial({ color: '#5fe3ff', toneMapped: false });
    const accentMat = new THREE.MeshBasicMaterial({ color: accent, toneMapped: false });
    const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      root.add(mesh);
      return mesh;
    };

    // Smooth capsule fuselage, slightly flattened.
    const bodyGeo = new THREE.CapsuleGeometry(1.0, 3.2, 8, 20);
    bodyGeo.rotateX(Math.PI / 2);
    bodyGeo.scale(1.05, 0.85, 1);
    add(bodyGeo, pearl, 0, 1.45, 0);

    // Wraparound tinted canopy over the front half.
    const canopyGeo = new THREE.SphereGeometry(1.0, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2);
    canopyGeo.scale(1.02, 0.75, 1.9);
    add(canopyGeo, mat('#1e3550', { roughness: 0.05, metalness: 0.7, transparent: true, opacity: 0.85 }), 0, 1.6, 1.0);

    // Light strips along both flanks + accent band.
    for (const sgn of [-1, 1]) {
      add(new THREE.BoxGeometry(0.03, 0.06, 3.6), glow, sgn * 1.06, 1.35, 0.2);
    }
    add(new THREE.TorusGeometry(0.93, 0.05, 6, 32), accentMat, 0, 1.45, -1.1).rotation.y = Math.PI / 2;

    // Tapered tail with a single swept fin and a glowing tip.
    const tailGeo = new THREE.ConeGeometry(0.55, 2.4, 16);
    tailGeo.rotateX(-Math.PI / 2);
    add(tailGeo, pearl, 0, 1.55, -3.2);
    const fin = add(new THREE.BoxGeometry(0.06, 1.0, 0.9), pearl, 0, 2.05, -3.6);
    fin.rotation.x = -0.5;
    add(new THREE.BoxGeometry(0.08, 0.08, 0.35), glow, 0, 2.5, -3.95);

    // Swept stub wings carrying ducted fans with glowing rims.
    const rotors: THREE.Object3D[] = [];
    for (const sgn of [-1, 1]) {
      const wing = add(new THREE.BoxGeometry(2.0, 0.1, 0.8), pearl, sgn * 1.8, 1.85, -0.2);
      wing.rotation.y = sgn * 0.18;
      const duct = add(new THREE.TorusGeometry(1.15, 0.2, 10, 32), pearl, sgn * 3.2, 1.95, -0.4);
      duct.rotation.x = Math.PI / 2;
      const rim = add(new THREE.TorusGeometry(1.15, 0.045, 6, 32), glow, sgn * 3.2, 2.17, -0.4);
      rim.rotation.x = Math.PI / 2;
      const fan = new THREE.Group();
      fan.position.set(sgn * 3.2, 1.95, -0.4);
      for (let k = 0; k < 5; k++) {
        const blade = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.03, 0.2), charcoal);
        blade.position.x = 0.52;
        const arm = new THREE.Group();
        arm.rotation.y = (k * Math.PI * 2) / 5;
        arm.add(blade);
        fan.add(arm);
      }
      fan.add(new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.2, 16), charcoal));
      root.add(fan);
      rotors.push(fan);
    }

    // Minimal landing pads instead of skids.
    for (const [x, z] of [[-0.7, 1.2], [0.7, 1.2], [-0.7, -1.2], [0.7, -1.2]]) {
      add(new THREE.CylinderGeometry(0.06, 0.06, 0.7, 8), charcoal, x, 0.4, z);
      add(new THREE.CylinderGeometry(0.2, 0.22, 0.06, 12), charcoal, x, 0.05, z);
    }
    return {
      root,
      wheels: [],
      halfLength: 5.2,
      halfWidth: 4.4,
      rotors,
      dispose: () => {
        disposeTree(root, false);
        glow.dispose();
        accentMat.dispose();
      },
    };
  }
}
