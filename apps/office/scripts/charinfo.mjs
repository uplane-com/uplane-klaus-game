import fs from 'fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
globalThis.self = globalThis; globalThis.createImageBitmap = undefined;
const loader = new GLTFLoader();
for (const f of process.argv.slice(2)) {
  const buf = fs.readFileSync(f);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  await new Promise((res) => loader.parse(ab, '', (g) => {
    g.scene.updateMatrixWorld(true);
    g.scene.traverse(o => {
      const wp = new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);
      let extra = '';
      if (o.isMesh) { o.geometry.computeBoundingBox(); const b=o.geometry.boundingBox; extra = ` geomBox min ${b.min.toArray().map(v=>v.toFixed(3))} max ${b.max.toArray().map(v=>v.toFixed(3))}`; }
      console.log(o.type.padEnd(12), o.name.padEnd(16), 'world', wp.toArray().map(v=>v.toFixed(3)).join(','), 'rot', o.rotation.toArray().slice(0,3).map(v=>v.toFixed(2)).join(','), 'scale', o.scale.x.toFixed(2), extra);
    });
    for (const a of g.animations.filter(a=>['idle','walk','sit','interact-right','emote-yes','pick-up'].includes(a.name))) console.log('anim', a.name, a.duration.toFixed(2), a.tracks.map(t=>t.name).join(' '));
    res();
  }, (e) => { console.log('ERR', e.message); res(); }));
}
