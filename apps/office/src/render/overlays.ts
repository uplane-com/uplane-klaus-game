import * as THREE from 'three';

/**
 * Status icons above heads (one Points draw call for all agents) and
 * department rings on the floor (one InstancedMesh).
 */

export const ICONS = {
  working: 0,
  thinking: 1,
  web_search: 2,
  docs: 3,
  api: 4,
  database: 5,
  ci: 6,
  image_gen: 7,
  deploy: 8,
  blocked: 9,
  error: 10,
  messaging: 11,
  meeting: 12,
  idle: 13,
  handoff: 14,
  hello: 15,
  brainstorm: 16,
  moodboard: 17,
  photo_shoot: 18,
  video_edit: 19,
  podcast: 20,
  broadcast: 21,
} as const;
export type IconName = keyof typeof ICONS;

const ICON_DEFS: { glyph: string; bg: string; ring: string }[] = [
  { glyph: '⌨️', bg: '#ffffff', ring: '#4f9dff' },
  { glyph: '💭', bg: '#ffffff', ring: '#9b87f5' },
  { glyph: '🔎', bg: '#ffffff', ring: '#35c7c7' },
  { glyph: '📚', bg: '#ffffff', ring: '#35c7c7' },
  { glyph: '🔌', bg: '#ffffff', ring: '#35c7c7' },
  { glyph: '🗄️', bg: '#ffffff', ring: '#35c7c7' },
  { glyph: '🧪', bg: '#ffffff', ring: '#35c7c7' },
  { glyph: '🎨', bg: '#ffffff', ring: '#35c7c7' },
  { glyph: '🚀', bg: '#ffffff', ring: '#35c7c7' },
  { glyph: '✋', bg: '#ffd166', ring: '#e69500' },
  { glyph: '❗', bg: '#ff6b6b', ring: '#c92a2a' },
  { glyph: '💬', bg: '#ffffff', ring: '#3ecf8e' },
  { glyph: '👥', bg: '#ffffff', ring: '#7c6ff0' },
  { glyph: '☕', bg: '#ffffff', ring: '#b08968' },
  { glyph: '📨', bg: '#ffffff', ring: '#ff8a5b' },
  { glyph: '👋', bg: '#ffffff', ring: '#adb5bd' },
  { glyph: '💡', bg: '#ffffff', ring: '#f15bb5' },
  { glyph: '📌', bg: '#ffffff', ring: '#f15bb5' },
  { glyph: '📸', bg: '#ffffff', ring: '#f15bb5' },
  { glyph: '🎬', bg: '#ffffff', ring: '#f15bb5' },
  { glyph: '🎙️', bg: '#ffffff', ring: '#ff3b3b' },
  { glyph: '📺', bg: '#ffffff', ring: '#ff3b3b' },
];
/** Icons per atlas row/column. */
const ATLAS_GRID = 5;

function buildAtlas(): THREE.Texture {
  const cell = 128;
  const c = document.createElement('canvas');
  c.width = c.height = cell * ATLAS_GRID;
  const ctx = c.getContext('2d')!;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ICON_DEFS.forEach((d, i) => {
    const cx = (i % ATLAS_GRID) * cell + cell / 2;
    const cy = Math.floor(i / ATLAS_GRID) * cell + cell / 2;
    ctx.beginPath();
    ctx.arc(cx, cy, cell * 0.42, 0, Math.PI * 2);
    ctx.fillStyle = d.bg;
    ctx.fill();
    ctx.lineWidth = 9;
    ctx.strokeStyle = d.ring;
    ctx.stroke();
    ctx.font = `${cell * 0.46}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
    ctx.fillText(d.glyph, cx, cy + 4);
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

export class StatusIcons {
  readonly points: THREE.Points;
  private readonly positions: Float32Array;
  private readonly icons: Float32Array;
  private readonly pulses: Float32Array;
  private readonly geo = new THREE.BufferGeometry();
  readonly material: THREE.ShaderMaterial;

  constructor(private readonly capacity: number) {
    this.positions = new Float32Array(capacity * 3);
    this.icons = new Float32Array(capacity).fill(-1);
    this.pulses = new Float32Array(capacity);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('icon', new THREE.BufferAttribute(this.icons, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('pulse', new THREE.BufferAttribute(this.pulses, 1).setUsage(THREE.DynamicDrawUsage));
    this.material = new THREE.ShaderMaterial({
      uniforms: { uAtlas: { value: buildAtlas() }, uSize: { value: 34 }, uTime: { value: 0 } },
      vertexShader: /* glsl */ `
        attribute float icon;
        attribute float pulse;
        uniform float uSize;
        uniform float uTime;
        varying float vIcon;
        void main() {
          vIcon = icon;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          float p = pulse > 0.5 ? 1.0 + 0.12 * sin(uTime * 7.0) : 1.0;
          gl_PointSize = icon < 0.0 ? 0.0 : uSize * p;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uAtlas;
        varying float vIcon;
        void main() {
          if (vIcon < 0.0) discard;
          vec2 cell = vec2(mod(vIcon, ${ATLAS_GRID}.0), floor(vIcon / ${ATLAS_GRID}.0));
          // Canvas textures are flipped (v=1 is the canvas top); PointCoord.y grows downwards.
          vec2 uv = vec2((cell.x + gl_PointCoord.x) / ${ATLAS_GRID}.0, 1.0 - (cell.y + gl_PointCoord.y) / ${ATLAS_GRID}.0);
          vec4 c = texture2D(uAtlas, uv);
          if (c.a < 0.05) discard;
          gl_FragColor = c;
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.points = new THREE.Points(this.geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
  }

  set(slot: number, x: number, y: number, z: number, icon: IconName | null, pulse = false) {
    this.positions[slot * 3] = x;
    this.positions[slot * 3 + 1] = y;
    this.positions[slot * 3 + 2] = z;
    this.icons[slot] = icon === null ? -1 : ICONS[icon];
    this.pulses[slot] = pulse ? 1 : 0;
  }

  clear(slot: number) {
    this.icons[slot] = -1;
  }

  commit(time: number, zoomPx: number) {
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.icon.needsUpdate = true;
    this.geo.attributes.pulse.needsUpdate = true;
    this.geo.setDrawRange(0, this.capacity);
    this.material.uniforms.uTime.value = time;
    this.material.uniforms.uSize.value = zoomPx;
  }
}

export class FloorRings {
  readonly mesh: THREE.InstancedMesh;
  readonly selection: THREE.Mesh;
  private readonly m = new THREE.Matrix4();
  private readonly hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  private readonly color = new THREE.Color();

  constructor(capacity: number) {
    const geo = new THREE.RingGeometry(0.46, 0.6, 28);
    geo.rotateX(-Math.PI / 2);
    this.mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.85, depthWrite: false }), capacity);
    for (let i = 0; i < capacity; i++) {
      this.mesh.setMatrixAt(i, this.hidden);
      this.mesh.setColorAt(i, this.color.set('#ffffff'));
    }
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;

    const selGeo = new THREE.RingGeometry(0.72, 0.9, 40);
    selGeo.rotateX(-Math.PI / 2);
    this.selection = new THREE.Mesh(selGeo, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.95, depthWrite: false }));
    this.selection.visible = false;
    this.selection.renderOrder = 2;
  }

  set(slot: number, x: number, z: number, color: string) {
    this.m.makeTranslation(x, 0.04, z);
    this.mesh.setMatrixAt(slot, this.m);
    this.mesh.setColorAt(slot, this.color.set(color));
  }

  clear(slot: number) {
    this.mesh.setMatrixAt(slot, this.hidden);
  }

  commit() {
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
