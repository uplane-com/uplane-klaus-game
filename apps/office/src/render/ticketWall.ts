import * as THREE from 'three';
import type { Ticket } from '@office/events';

/**
 * Linear ticket wall: a framed cork board with the Linear logo and one column
 * per state (Todo / In progress / In review / Done). Each ticket is a paper
 * note pinned to the cork, coloured by priority. Redrawn when tickets change.
 */

const W = 2048;
const H = 1024;
const MAX_PER_COLUMN = 5;
const NOTE_H = 132;
const NOTE_STEP = 144;
const DONE_WINDOW_MS = 24 * 3600 * 1000;

const COLUMNS: { title: string; match: (t: Ticket) => boolean }[] = [
  { title: 'Todo', match: (t) => t.stateType === 'unstarted' || t.stateType === 'triage' },
  { title: 'In progress', match: (t) => t.stateType === 'started' && !/review/i.test(t.stateName) },
  { title: 'In review', match: (t) => t.stateType === 'started' && /review/i.test(t.stateName) },
  { title: 'Done', match: (t) => t.stateType === 'completed' && Date.now() - t.updatedAt < DONE_WINDOW_MS },
];

/** Paper colour by Linear priority (1 urgent … 4 low, 0 none). */
const PAPER = ['#fbf6e9', '#ffc4bd', '#ffd9a8', '#fff1a8', '#e6f0ff'];
const PINS = ['#e5484d', '#3e63dd', '#30a46c', '#f5a524', '#8e4ec6'];

/** Small deterministic hash so a note keeps its tilt and pin colour. */
function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967295;
}

export class TicketWall {
  readonly group = new THREE.Group();
  private readonly canvas = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  private readonly texture: THREE.CanvasTexture;
  private readonly cork: HTMLCanvasElement;

  constructor(spot: { x: number; z: number; w: number; h: number }) {
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d')!;
    this.cork = corkTexture();
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 8;

    const bottom = 0.35;
    const wood = new THREE.MeshStandardMaterial({ color: '#8a6a48', roughness: 0.7 });
    const frame = new THREE.Mesh(new THREE.BoxGeometry(spot.w + 0.16, spot.h + 0.16, 0.1), wood);
    frame.position.y = bottom + spot.h / 2;
    frame.castShadow = true;
    const face = new THREE.Mesh(new THREE.PlaneGeometry(spot.w, spot.h), new THREE.MeshStandardMaterial({ map: this.texture, roughness: 0.9 }));
    face.position.set(0, bottom + spot.h / 2, 0.052);
    this.group.add(frame, face);
    for (const s of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, bottom + 0.1, 0.1), wood);
      leg.position.set((s * spot.w) / 2.3, (bottom + 0.1) / 2, 0);
      this.group.add(leg);
    }
    this.group.position.set(spot.x, 0, spot.z);
    this.draw([]);
  }

  setTickets(tickets: Iterable<Ticket>) {
    this.draw([...tickets]);
  }

  private draw(tickets: Ticket[]) {
    const ctx = this.ctx;
    ctx.drawImage(this.cork, 0, 0, W, H);

    // Header strip: Linear logo + name + ticket count.
    const open = tickets.filter((t) => t.stateType === 'unstarted' || t.stateType === 'triage' || t.stateType === 'started').length;
    this.paper(40, 26, 700, 110, '#ffffff', -0.008);
    drawLinearLogo(ctx, 72, 38, 86);
    ctx.fillStyle = '#16171d';
    ctx.font = '700 64px Inter, system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText('Linear', 180, 82);
    ctx.font = '500 34px Inter, system-ui, sans-serif';
    ctx.fillStyle = '#6b6f7b';
    ctx.fillText(`${open} open`, 420, 84);
    this.pin(390, 40, '#5e6ad2');

    const colW = (W - 80) / COLUMNS.length;
    COLUMNS.forEach((col, ci) => {
      const x0 = 40 + ci * colW;
      const items = tickets
        .filter(col.match)
        .sort((a, b) => (a.priority || 9) - (b.priority || 9) || b.updatedAt - a.updatedAt);
      // Column label on a paper strip.
      this.paper(x0 + 14, 164, colW - 28, 64, '#fdfcf7', (hash(col.title) - 0.5) * 0.03);
      ctx.fillStyle = '#16171d';
      ctx.font = '700 38px Inter, system-ui, sans-serif';
      ctx.fillText(col.title, x0 + 40, 197);
      ctx.fillStyle = '#8b8f99';
      ctx.font = '600 34px Inter, system-ui, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(String(items.length), x0 + colW - 40, 197);
      ctx.textAlign = 'left';

      const shown = items.slice(0, MAX_PER_COLUMN);
      shown.forEach((t, i) => {
        const r = hash(t.id);
        const y = 252 + i * NOTE_STEP;
        const tilt = (r - 0.5) * 0.06;
        const done = t.stateType === 'completed';
        this.paper(x0 + 18 + r * 10, y, colW - 46, NOTE_H, done ? '#eceae3' : PAPER[t.priority] ?? PAPER[0], tilt);
        ctx.save();
        ctx.translate(x0 + 18 + r * 10, y);
        ctx.rotate(tilt);
        ctx.fillStyle = done ? '#8b8f99' : '#5b5f6b';
        ctx.font = '700 28px ui-monospace, Menlo, monospace';
        ctx.fillText(t.key + (done ? '  ✓' : ''), 22, 32);
        ctx.fillStyle = done ? '#8b8f99' : '#16171d';
        ctx.font = '500 30px Inter, system-ui, sans-serif';
        wrap(ctx, t.title, 22, 72, colW - 90, 36, 2);
        ctx.restore();
        this.pin(x0 + colW / 2 + (r - 0.5) * 40, y + 6, PINS[Math.floor(r * PINS.length)]);
      });
      if (items.length > shown.length) {
        ctx.fillStyle = '#fdfcf7';
        ctx.font = '600 30px Inter, system-ui, sans-serif';
        ctx.fillText(`+${items.length - shown.length} more`, x0 + 32, 252 + MAX_PER_COLUMN * NOTE_STEP + 14);
      }
    });
    this.texture.needsUpdate = true;
  }

  /** A sheet of paper with a soft drop shadow. */
  private paper(x: number, y: number, w: number, h: number, color: string, tilt: number) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(tilt);
    ctx.shadowColor = 'rgba(40, 25, 10, 0.35)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 5;
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  private pin(x: number, y: number, color: string) {
    const ctx = this.ctx;
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 3;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.beginPath();
    ctx.arc(x - 4, y - 4, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

/** Linear mark: a purple disc with three diagonal cuts towards the lower left. */
export function drawLinearLogo(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  const r = size / 2;
  const cx = x + r;
  const cy = y + r;
  ctx.save();
  const g = ctx.createLinearGradient(x, y, x + size, y + size);
  g.addColorStop(0, '#7b85e8');
  g.addColorStop(1, '#5e6ad2');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  // Three parallel cuts (top-left → bottom-right) stacked towards the lower-left edge, clipped to the disc.
  ctx.clip();
  ctx.translate(cx, cy);
  ctx.rotate(Math.PI / 4);
  ctx.fillStyle = '#ffffff';
  for (const d of [0.22, 0.52, 0.8]) ctx.fillRect(-size, d * r - size * 0.035, size * 2, size * 0.07);
  ctx.restore();
}

function wrap(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lineH: number, maxLines: number) {
  const words = text.split(/\s+/);
  let line = '';
  let lines = 0;
  for (let i = 0; i < words.length; i++) {
    const test = line ? `${line} ${words[i]}` : words[i];
    if (ctx.measureText(test).width > maxW && line) {
      if (lines === maxLines - 1) {
        let cut = line;
        while (ctx.measureText(`${cut}…`).width > maxW && cut.length) cut = cut.slice(0, -1);
        ctx.fillText(`${cut}…`, x, y + lines * lineH);
        return;
      }
      ctx.fillText(line, x, y + lines * lineH);
      lines++;
      line = words[i];
    } else line = test;
  }
  if (line) ctx.fillText(line, x, y + lines * lineH);
}

/** Warm cork with speckles. */
function corkTexture(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#c8a06f';
  ctx.fillRect(0, 0, W, H);
  let s = 12345;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 9000; i++) {
    ctx.fillStyle = rnd() < 0.5 ? 'rgba(120, 80, 40, 0.22)' : 'rgba(240, 210, 160, 0.25)';
    const r = 1 + rnd() * 3.5;
    ctx.fillRect(rnd() * W, rnd() * H, r, r);
  }
  return c;
}
