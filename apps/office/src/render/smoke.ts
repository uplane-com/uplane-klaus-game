import * as THREE from 'three';
import type { Box } from '../world/layout';

/**
 * Smoke billowing out of the server racks during an incident. A fixed pool of
 * particles in one Points draw call; sizes are in world units so it scales
 * with the orthographic zoom.
 */

const POOL = 600;

export class Smoke {
  readonly points: THREE.Points;
  private readonly pos = new Float32Array(POOL * 3);
  private readonly vel = new Float32Array(POOL * 3);
  private readonly age = new Float32Array(POOL);
  private readonly life = new Float32Array(POOL);
  private readonly size = new Float32Array(POOL);
  private readonly alpha = new Float32Array(POOL);
  private readonly shade = new Float32Array(POOL);
  private readonly geo = new THREE.BufferGeometry();
  private readonly material: THREE.ShaderMaterial;
  private next = 0;
  private emitAcc = 0;
  private level = 0;

  constructor(private readonly racks: Box[]) {
    this.life.fill(0);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('shade', new THREE.BufferAttribute(this.shade, 1).setUsage(THREE.DynamicDrawUsage));
    this.material = new THREE.ShaderMaterial({
      uniforms: { uPxPerUnit: { value: 10 } },
      vertexShader: /* glsl */ `
        attribute float size;
        attribute float alpha;
        attribute float shade;
        uniform float uPxPerUnit;
        varying float vAlpha;
        varying float vShade;
        void main() {
          vAlpha = alpha;
          vShade = shade;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = alpha <= 0.0 ? 0.0 : size * uPxPerUnit;
        }`,
      fragmentShader: /* glsl */ `
        varying float vAlpha;
        varying float vShade;
        void main() {
          vec2 d = gl_PointCoord - 0.5;
          float r = length(d);
          if (r > 0.5) discard;
          float soft = smoothstep(0.5, 0.0, r);
          gl_FragColor = vec4(vec3(vShade), vAlpha * soft);
        }`,
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(this.geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
  }

  private emit() {
    const r = this.racks[Math.floor(Math.random() * this.racks.length)];
    if (!r) return;
    const i = this.next;
    this.next = (this.next + 1) % POOL;
    this.pos[i * 3] = r.x + (Math.random() - 0.5) * r.w * 0.8;
    this.pos[i * 3 + 1] = r.h + 0.05;
    this.pos[i * 3 + 2] = r.z + (Math.random() - 0.5) * r.d * 0.8;
    this.vel[i * 3] = (Math.random() - 0.5) * 0.35 + 0.15;
    this.vel[i * 3 + 1] = 0.7 + Math.random() * 0.8;
    this.vel[i * 3 + 2] = (Math.random() - 0.5) * 0.35;
    this.age[i] = 0;
    this.life[i] = 3.5 + Math.random() * 2.5;
    this.shade[i] = 0.55 + Math.random() * 0.3;
  }

  update(dt: number, active: boolean, pxPerUnit: number) {
    this.level += ((active ? 1 : 0) - this.level) * (1 - Math.exp(-1.5 * dt));
    this.emitAcc += dt * 60 * this.level;
    while (this.emitAcc > 1) {
      this.emit();
      this.emitAcc -= 1;
    }
    let alive = false;
    for (let i = 0; i < POOL; i++) {
      if (this.life[i] <= 0) {
        this.alpha[i] = 0;
        continue;
      }
      this.age[i] += dt;
      const t = this.age[i] / this.life[i];
      if (t >= 1) {
        this.life[i] = 0;
        this.alpha[i] = 0;
        continue;
      }
      alive = true;
      this.vel[i * 3 + 1] *= 1 - 0.25 * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] = 0.8 + t * 3.4;
      this.alpha[i] = Math.min(1, t * 5) * (1 - t) * 0.85;
    }
    this.points.visible = alive;
    if (!alive) return;
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.size.needsUpdate = true;
    this.geo.attributes.alpha.needsUpdate = true;
    this.geo.attributes.shade.needsUpdate = true;
    this.material.uniforms.uPxPerUnit.value = pxPerUnit;
  }
}
