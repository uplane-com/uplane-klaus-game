import * as THREE from 'three';
import type { TaskAsset } from '@office/events';

/**
 * The asset a finished agent made, carried out of the office as a balloon: a
 * card with the picture (a sprite, so it always faces the camera) on a string
 * held in the right hand. The card floats up, trails behind while walking and
 * sways a little. Built when the picture has loaded; a picture that cannot load
 * leaves a card with only the caption.
 */

/** Card width in world units (a character is about 1.75 tall). */
const CARD_WIDTH = 1.8;
/** From the hand to the bottom of the card. */
const STRING_LENGTH = 1.7;
/** Zoomed out further than this (TV overview), cards and strings grow, up to MAX_BOOST times. */
const BOOST_ZOOM = 2;
const MAX_BOOST = 1.8;
/** Upward pull and air drag of the balloon (per second). */
const LIFT = 7;
const DRAG = 2.4;
const POP_SECONDS = 0.45;

/** Card texture layout (canvas pixels). */
const TEX_W = 256;
const PAD = 12;
const IMG_MAX_W = TEX_W - PAD * 2;
/** Tall pictures (9:16 videos) stop here and get narrower instead. */
const IMG_MAX_H = IMG_MAX_W * 1.3;
const TITLE_H = 34;
const KNOT_H = 14;
const BORDER = '#dfe2e8';

const images = new Map<string, Promise<HTMLImageElement | null>>();
const MAX_CACHED_IMAGES = 24;

/** CORS image load (the canvas must stay untainted to become a texture); null when it fails. */
function loadImage(url: string): Promise<HTMLImageElement | null> {
  let p = images.get(url);
  if (!p) {
    p = new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.decoding = 'async';
      img.onload = () => resolve(img.naturalWidth > 0 ? img : null);
      img.onerror = () => resolve(null);
      img.src = url;
    });
    images.set(url, p);
    if (images.size > MAX_CACHED_IMAGES) images.delete(images.keys().next().value!);
  }
  return p;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function ellipsize(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > maxW) s = s.slice(0, -1);
  return `${s.trimEnd()}…`;
}

/** White card with the picture, the caption under it and a knot at the bottom for the string. */
function drawCard(img: HTMLImageElement | null, title: string | undefined): HTMLCanvasElement {
  let iw = 0;
  let ih = 0;
  if (img) {
    const aspect = img.naturalHeight / img.naturalWidth;
    ih = Math.min(IMG_MAX_H, IMG_MAX_W * aspect);
    iw = ih / aspect;
  }
  const caption = title ?? (img ? '' : 'Done');
  const cardH = PAD + ih + (caption ? (img ? 4 : 0) + TITLE_H : 0) + (caption && !img ? 0 : PAD);
  const c = document.createElement('canvas');
  c.width = TEX_W;
  c.height = Math.ceil(cardH + KNOT_H + 2);
  const ctx = c.getContext('2d')!;

  // Knot first, so the card's border covers its top edge.
  ctx.beginPath();
  ctx.moveTo(TEX_W / 2 - 9, cardH - 2);
  ctx.lineTo(TEX_W / 2 + 9, cardH - 2);
  ctx.lineTo(TEX_W / 2, cardH + KNOT_H);
  ctx.closePath();
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = BORDER;
  ctx.stroke();

  roundRect(ctx, 1, 1, TEX_W - 2, cardH - 2, 22);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.stroke();

  if (img) {
    ctx.save();
    roundRect(ctx, (TEX_W - iw) / 2, PAD, iw, ih, 12);
    ctx.clip();
    ctx.drawImage(img, (TEX_W - iw) / 2, PAD, iw, ih);
    ctx.restore();
  }
  if (caption) {
    ctx.font = `600 21px "Lab Grotesque", -apple-system, "Helvetica Neue", Arial, sans-serif`;
    ctx.fillStyle = '#0a0a0a';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ellipsize(ctx, caption, TEX_W - PAD * 2 - 8), TEX_W / 2, PAD + ih + (img ? 4 : 0) + TITLE_H / 2);
  }
  return c;
}

/** Unit-length string along +y from its origin; stretched between hand and card every frame. */
const stringGeo = new THREE.CylinderGeometry(0.022, 0.022, 1, 5, 1, true).translate(0, 0.5, 0);
const stringMat = new THREE.MeshBasicMaterial({ color: '#4b5160' });
const UP = new THREE.Vector3(0, 1, 0);
const tmp = new THREE.Vector3();
const radial = new THREE.Vector3();

export class Balloon {
  /** Camera zoom, set once per frame. */
  static zoom = 1;
  /** Child of the character's root, so it hides, fades and rides along with it. */
  readonly group = new THREE.Group();
  private sprite: THREE.Sprite | null = null;
  private readonly line: THREE.Mesh;
  private readonly lineMat = stringMat.clone();
  /** Balloon position (bottom of the card) and velocity in world space. */
  private readonly pos = new THREE.Vector3();
  private readonly vel = new THREE.Vector3();
  private placed = false;
  private age = 0;
  private shown = 0;
  private opacity = 1;
  private disposed = false;
  private readonly seed = Math.random() * 100;

  constructor(readonly asset: TaskAsset) {
    this.line = new THREE.Mesh(stringGeo, this.lineMat);
    this.line.frustumCulled = false;
    this.line.visible = false;
    this.group.add(this.line);
    void loadImage(asset.imageUrl).then((img) => this.build(img));
  }

  private build(img: HTMLImageElement | null) {
    if (this.disposed) return;
    const canvas = drawCard(img, this.asset.title);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false });
    const sprite = new THREE.Sprite(mat);
    sprite.center.set(0.5, 0);
    sprite.userData.height = (CARD_WIDTH * canvas.height) / canvas.width;
    sprite.frustumCulled = false;
    sprite.renderOrder = 9;
    this.sprite = sprite;
    this.group.add(sprite);
    this.age = 0;
  }

  /** `hand`: world position of the hand holding the string; `root`: the character's root (matrix up to date). */
  update(dt: number, hand: THREE.Vector3, root: THREE.Object3D) {
    if (!this.sprite) return;
    const boost = THREE.MathUtils.clamp(BOOST_ZOOM / Balloon.zoom, 1, MAX_BOOST);
    const length = STRING_LENGTH * boost;
    if (!this.placed) {
      this.placed = true;
      this.pos.copy(hand).y += length;
    }
    this.age += dt;
    const t = this.age + this.seed;
    // Lift, a little breeze, air drag; then the string holds it at most `length` from the hand.
    this.vel.x += Math.sin(t * 0.9) * 0.9 * dt;
    this.vel.z += Math.cos(t * 0.7) * 0.9 * dt;
    this.vel.y += LIFT * dt;
    this.vel.multiplyScalar(Math.exp(-DRAG * dt));
    this.pos.addScaledVector(this.vel, dt);
    radial.subVectors(this.pos, hand);
    const len = radial.length();
    if (len > length) {
      radial.divideScalar(len);
      this.pos.copy(hand).addScaledVector(radial, length);
      const out = this.vel.dot(radial);
      if (out > 0) this.vel.addScaledVector(radial, -out);
    }

    // Pop in: overshoot, then settle.
    const k = Math.min(1, this.age / POP_SECONDS);
    const pop = k >= 1 ? 1 : 1 + Math.sin(k * Math.PI) * 0.25 - (1 - k) * (1 - k);
    this.shown = Math.max(0, pop);
    const size = this.shown * boost;
    this.sprite.scale.set(CARD_WIDTH * size, (this.sprite.userData.height as number) * size, 1);
    this.sprite.position.copy(root.worldToLocal(tmp.copy(this.pos)));
    root.worldToLocal(this.line.position.copy(hand));
    tmp.subVectors(this.sprite.position, this.line.position);
    const span = tmp.length();
    this.line.quaternion.setFromUnitVectors(UP, tmp.divideScalar(span || 1));
    this.line.scale.set(boost, span, boost);
    this.line.visible = true;
    this.applyOpacity();
  }

  setOpacity(o: number) {
    this.opacity = o;
    this.applyOpacity();
  }

  private applyOpacity() {
    const o = this.opacity * Math.min(1, this.shown);
    if (this.sprite) (this.sprite.material as THREE.SpriteMaterial).opacity = o;
    this.lineMat.transparent = o < 1;
    this.lineMat.opacity = o;
  }

  dispose() {
    this.disposed = true;
    this.group.removeFromParent();
    this.lineMat.dispose();
    if (this.sprite) {
      const mat = this.sprite.material as THREE.SpriteMaterial;
      mat.map?.dispose();
      mat.dispose();
    }
  }
}
