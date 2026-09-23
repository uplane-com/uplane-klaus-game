import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FURNITURE_MODELS, FURNITURE_SCALE, type FurnitureModel } from '../config/scale';

export interface ModelPart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
}

/** Furniture model baked into a list of (geometry, material) parts. */
export type ModelProto = ModelPart[];

const loader = new GLTFLoader();

export function loadGLTF(url: string): Promise<GLTF> {
  return loader.loadAsync(url);
}

/**
 * Loads each furniture GLB, bakes node transforms into the geometry, centres
 * the footprint on the origin (base at y=0) and applies the world scale.
 * Materials are shared across models by name to keep state changes low.
 */
export async function loadFurniture(): Promise<Map<FurnitureModel, ModelProto>> {
  const materials = new Map<string, THREE.Material>();
  const protos = new Map<FurnitureModel, ModelProto>();
  await Promise.all(
    FURNITURE_MODELS.map(async (name) => {
      const gltf = await loadGLTF(`models/furniture/${name}.glb`);
      const scene = gltf.scene;
      scene.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(scene);
      const center = box.getCenter(new THREE.Vector3());
      const offset = new THREE.Matrix4().makeTranslation(-center.x, -box.min.y, -center.z);
      const scale = new THREE.Matrix4().makeScale(FURNITURE_SCALE, FURNITURE_SCALE, FURNITURE_SCALE);
      const parts: ModelPart[] = [];
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const geometry = mesh.geometry.clone();
        geometry.applyMatrix4(mesh.matrixWorld);
        geometry.applyMatrix4(offset);
        geometry.applyMatrix4(scale);
        const src = mesh.material as THREE.MeshStandardMaterial;
        let mat = materials.get(src.name);
        if (!mat) {
          mat = src.clone();
          (mat as THREE.MeshStandardMaterial).roughness = 0.85;
          (mat as THREE.MeshStandardMaterial).metalness = Math.min(0.2, src.metalness);
          materials.set(src.name, mat);
        }
        parts.push({ geometry, material: mat });
      });
      protos.set(name, parts);
    }),
  );
  return protos;
}
