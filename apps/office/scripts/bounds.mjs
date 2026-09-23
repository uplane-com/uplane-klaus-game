import fs from 'fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
globalThis.self = globalThis;
globalThis.self = globalThis;
const loader = new GLTFLoader();
const files = process.argv.slice(2);
for (const f of files) {
  const buf = fs.readFileSync(f);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  await new Promise((res) => loader.parse(ab, '', (g) => {
    const box = new THREE.Box3().setFromObject(g.scene);
    let prims = 0; const mats = new Set();
    g.scene.traverse(o => { if (o.isMesh) { prims++; (Array.isArray(o.material)?o.material:[o.material]).forEach(m=>mats.add(m.name)); } });
    const s = box.getSize(new THREE.Vector3());
    console.log(f.split('/').pop().padEnd(32), 'min', box.min.toArray().map(v=>v.toFixed(2)).join(','), 'size', s.toArray().map(v=>v.toFixed(2)).join(','), 'meshes', prims, [...mats].join('|'));
    res();
  }, (e) => { console.log(f, 'ERR', e.message); res(); }));
}
