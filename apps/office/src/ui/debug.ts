import * as THREE from 'three';
import type { Quality } from '../config/quality';

/**
 * `?debug` overlay for checking what a TV / signage player can handle:
 * GPU, quality preset, resolution, fps, draw calls, memory and the last error.
 * Stays visible in kiosk mode.
 */
export class DebugOverlay {
  private readonly el: HTMLElement;
  private readonly gpu: string;
  private frames = 0;
  private last = performance.now();
  private lastError = '';
  private readonly size = new THREE.Vector2();

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly quality: Quality,
    private readonly agents: () => number,
  ) {
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    this.gpu = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
    this.el = document.createElement('div');
    this.el.className = 'debug-overlay';
    document.body.appendChild(this.el);
    window.addEventListener('error', (e) => (this.lastError = e.message));
    window.addEventListener('unhandledrejection', (e) => (this.lastError = String(e.reason)));
  }

  error(message: string) {
    this.lastError = message;
  }

  /** Call once per rendered frame. */
  frame() {
    this.frames++;
    const now = performance.now();
    if (now - this.last < 1000) return;
    const fps = (this.frames * 1000) / (now - this.last);
    this.frames = 0;
    this.last = now;
    const info = this.renderer.info;
    const size = this.renderer.getDrawingBufferSize(this.size);
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
    const lines = [
      `quality ${this.quality.level} · ${size.x}×${size.y}px · dpr ${window.devicePixelRatio}`,
      `GPU ${this.gpu}`,
      `${fps.toFixed(0)} fps · ${info.render.calls} calls · ${(info.render.triangles / 1000).toFixed(0)}k tris`,
      `geometries ${info.memory.geometries} · textures ${info.memory.textures} · agents ${this.agents()}`,
      mem ? `JS heap ${(mem.usedJSHeapSize / 1e6).toFixed(0)} / ${(mem.jsHeapSizeLimit / 1e6).toFixed(0)} MB` : 'JS heap n/a',
      this.lastError ? `last error: ${this.lastError}` : 'no errors',
    ];
    this.el.textContent = lines.join('\n');
  }
}
