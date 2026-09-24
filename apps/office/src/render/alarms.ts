import * as THREE from 'three';
import type { AlarmLamp } from '../world/layout';

/**
 * Office-wide incident alert: rotating red beacons on the walls, a pulsing
 * red wash over the whole scene and dimmed daylight. `update(dt, active)`
 * fades the effect in and out smoothly.
 */
export class AlarmSystem {
  readonly group = new THREE.Group();
  private readonly domes: THREE.InstancedMesh;
  private readonly bases: THREE.InstancedMesh;
  private readonly beams: THREE.InstancedMesh;
  private readonly domeMat: THREE.MeshStandardMaterial;
  private readonly beamMat: THREE.MeshBasicMaterial;
  private readonly redLight = new THREE.AmbientLight('#ff2a2a', 0);
  private level = 0;
  private angle = 0;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly up = new THREE.Vector3(0, 1, 0);

  constructor(
    private readonly lamps: AlarmLamp[],
    private readonly sun: THREE.DirectionalLight,
    private readonly hemi: THREE.HemisphereLight,
  ) {
    const n = Math.max(1, lamps.length);
    const base = (this.bases = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.2, 0.24, 0.14, 12).translate(0, 0.07, 0), new THREE.MeshStandardMaterial({ color: '#2b2f38' }), n));
    this.domeMat = new THREE.MeshStandardMaterial({ color: '#7a1515', emissive: '#ff1a1a', emissiveIntensity: 0, roughness: 0.3 });
    this.domes = new THREE.InstancedMesh(new THREE.SphereGeometry(0.2, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.14, 0), this.domeMat, n);

    // Two light cones pointing sideways, spun around the lamp's axis.
    const cone = new THREE.ConeGeometry(0.9, 3.2, 16, 1, true);
    cone.translate(0, -1.6, 0);
    cone.rotateZ(Math.PI / 2);
    const cone2 = cone.clone().rotateY(Math.PI);
    const beamGeo = mergeTwo(cone, cone2);
    beamGeo.translate(0, 0.24, 0);
    this.beamMat = new THREE.MeshBasicMaterial({
      color: '#ff3030',
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.beams = new THREE.InstancedMesh(beamGeo, this.beamMat, n);
    this.beams.frustumCulled = false;
    this.beams.renderOrder = 5;

    lamps.forEach((l, i) => {
      this.m.makeTranslation(l.x, l.y, l.z);
      base.setMatrixAt(i, this.m);
      this.domes.setMatrixAt(i, this.m);
    });
    this.group.add(base, this.domes, this.beams, this.redLight);
    this.beams.visible = false;
    // Lamps only exist while there is an alert.
    this.group.visible = false;
  }

  /** Normal light levels (set by the day/night cycle); an alert dims relative to these. */
  baseSun = 2.3;
  baseHemi = 1.4;

  get active() {
    return this.level > 0.01;
  }

  update(dt: number, alert: boolean, time: number) {
    this.level += ((alert ? 1 : 0) - this.level) * (1 - Math.exp(-3 * dt));
    const k = this.level;
    const pulse = 0.5 + 0.5 * Math.sin(time * 6);
    this.domeMat.emissiveIntensity = k * (1.5 + 2 * pulse);
    this.beamMat.opacity = k * 0.28;
    this.beams.visible = k > 0.02;
    this.redLight.intensity = k * (0.4 + 0.9 * pulse);
    this.sun.intensity = this.baseSun * (1 - 0.45 * k);
    this.hemi.intensity = this.baseHemi * (1 - 0.35 * k);

    this.group.visible = k > 0.01;
    if (!this.group.visible) return;
    // Beacons pop up out of the walls as the alert fades in.
    const rise = Math.min(1, k * 1.5);
    this.lamps.forEach((l, i) => {
      this.m.compose(new THREE.Vector3(l.x, l.y, l.z), this.q.identity(), new THREE.Vector3(rise, rise, rise));
      this.bases.setMatrixAt(i, this.m);
      this.domes.setMatrixAt(i, this.m);
    });
    this.bases.instanceMatrix.needsUpdate = true;
    this.domes.instanceMatrix.needsUpdate = true;

    if (!this.beams.visible) return;
    this.angle += dt * 4.5;
    this.lamps.forEach((l, i) => {
      this.q.setFromAxisAngle(this.up, this.angle + i * 0.7);
      this.m.compose(new THREE.Vector3(l.x, l.y, l.z), this.q, new THREE.Vector3(1, 1, 1));
      this.beams.setMatrixAt(i, this.m);
    });
    this.beams.instanceMatrix.needsUpdate = true;
  }
}

function mergeTwo(a: THREE.BufferGeometry, b: THREE.BufferGeometry): THREE.BufferGeometry {
  const pa = a.toNonIndexed().getAttribute('position').array as Float32Array;
  const pb = b.toNonIndexed().getAttribute('position').array as Float32Array;
  const merged = new Float32Array(pa.length + pb.length);
  merged.set(pa, 0);
  merged.set(pb, pa.length);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(merged, 3));
  return g;
}
