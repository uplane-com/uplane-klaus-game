import * as THREE from 'three';
import { MapControls } from 'three/examples/jsm/controls/MapControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { Quality } from '../config/quality';

/** Renderer, isometric-style orthographic camera, controls and lights. */
export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.OrthographicCamera;
  readonly controls: MapControls;
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  private readonly viewHeight = 70;

  constructor(
    container: HTMLElement,
    center: THREE.Vector3,
    readonly quality: Quality,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: quality.antialias, powerPreference: 'high-performance' });
    // Lower quality renders fewer pixels and lets the browser scale the canvas up.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality.maxPixelRatio) * quality.renderScale);
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = quality.shadows !== 'off';
    // Static shadows: the map is only re-rendered on request (see refreshShadows).
    this.renderer.shadowMap.autoUpdate = quality.shadows !== 'static';
    this.renderer.shadowMap.type = quality.softShadows ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.98;
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color('#bcd3e6');
    this.scene.fog = new THREE.Fog('#bcd3e6', 260, 520);

    const aspect = container.clientWidth / container.clientHeight;
    const h = this.viewHeight / 2;
    // Negative near plane: an orthographic view doesn't change with depth, and it keeps tall
    // city towers between the camera and the office from being sliced off at the top.
    this.camera = new THREE.OrthographicCamera(-h * aspect, h * aspect, h, -h, -400, 1000);
    this.camera.position.copy(center).add(new THREE.Vector3(-55, 95, 95));
    this.camera.zoom = 1.1;
    this.camera.updateProjectionMatrix();

    this.controls = new MapControls(this.camera, this.renderer.domElement);
    this.controls.target.copy(center);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.screenSpacePanning = false;
    this.controls.minZoom = 0.45;
    this.controls.maxZoom = 12;
    this.controls.minPolarAngle = 0.25;
    this.controls.maxPolarAngle = 1.2;
    this.controls.zoomToCursor = true;
    this.controls.update();

    // Soft studio reflections: glass, cars, the robot and water pick up highlights.
    if (quality.environment) {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      this.scene.environmentIntensity = 0.22;
      pmrem.dispose();
    }

    this.hemi = new THREE.HemisphereLight('#f4f7ff', '#8a8f7a', 1.2);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight('#fff4e0', 2.3);
    this.sun.position.copy(center).add(new THREE.Vector3(-45, 90, 35));
    this.sun.target.position.copy(center);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
    const sc = this.sun.shadow.camera;
    sc.left = -80;
    sc.right = 80;
    sc.top = 70;
    sc.bottom = -70;
    sc.near = 1;
    sc.far = 260;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun, this.sun.target);

    window.addEventListener('resize', () => this.resize(container));
  }

  private resize(container: HTMLElement) {
    const w = container.clientWidth;
    const hgt = container.clientHeight;
    const aspect = w / hgt;
    const h = this.viewHeight / 2;
    this.camera.left = -h * aspect;
    this.camera.right = h * aspect;
    this.camera.top = h;
    this.camera.bottom = -h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, hgt);
  }

  /** Keep the camera orbit but move its focus to a point (follow mode). */
  focus(x: number, z: number, lambda: number, dt: number) {
    const t = this.controls.target;
    const k = 1 - Math.exp(-lambda * dt);
    const dx = (x - t.x) * k;
    const dz = (z - t.z) * k;
    t.x += dx;
    t.z += dz;
    this.camera.position.x += dx;
    this.camera.position.z += dz;
  }

  /** Objects whose shadows are baked in static mode (the office); everything else is left out. */
  staticCasters: THREE.Object3D | null = null;
  private shadowsDirty = true;

  /** Static shadow mode: re-render the shadow map on the next frame (e.g. the sun moved). */
  refreshShadows() {
    this.shadowsDirty = true;
  }

  render() {
    this.controls.update();
    const r = this.renderer;
    if (!r.shadowMap.autoUpdate && r.shadowMap.enabled && this.shadowsDirty && this.staticCasters) {
      // Bake shadows with only the office visible (no people or cars frozen into the map),
      // then draw the real frame reusing that map.
      this.shadowsDirty = false;
      const hidden: THREE.Object3D[] = [];
      for (const o of this.scene.children) {
        if (o === this.staticCasters || (o as THREE.Light).isLight || o === this.sun.target || !o.visible) continue;
        o.visible = false;
        hidden.push(o);
      }
      r.shadowMap.needsUpdate = true;
      r.render(this.scene, this.camera);
      for (const o of hidden) o.visible = true;
    }
    r.render(this.scene, this.camera);
  }
}
