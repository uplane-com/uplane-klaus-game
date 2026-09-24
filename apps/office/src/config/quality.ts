/**
 * Render quality presets, chosen with `?quality=low|medium|high` (default high).
 * `low` is meant for weak signage players (Fire TV / Signage Stick, Chromecast,
 * Android TV boxes): native resolution at 1x, static shadows (re-rendered only
 * when the sun moves, people and cars excluded), no reflections, 30 fps and
 * characters animated every other frame.
 */
export type QualityLevel = 'low' | 'medium' | 'high';

export interface Quality {
  level: QualityLevel;
  antialias: boolean;
  /** Upper limit for devicePixelRatio. */
  maxPixelRatio: number;
  /** Fraction of the (capped) pixel ratio actually rendered; the canvas is scaled up. */
  renderScale: number;
  /** off, static (office only, refreshed when the sun moves) or dynamic (every frame). */
  shadows: 'off' | 'static' | 'dynamic';
  shadowMapSize: number;
  softShadows: boolean;
  /** Image-based reflections (glass, cars, water). */
  environment: boolean;
  maxFps: number;
  /** Advance character skeletons every N frames (1 = every frame). */
  animEvery: number;
}

const PRESETS: Record<QualityLevel, Omit<Quality, 'level'>> = {
  low: { antialias: true, maxPixelRatio: 1, renderScale: 1, shadows: 'static', shadowMapSize: 2048, softShadows: true, environment: false, maxFps: 30, animEvery: 2 },
  medium: { antialias: true, maxPixelRatio: 1, renderScale: 1, shadows: 'dynamic', shadowMapSize: 2048, softShadows: false, environment: true, maxFps: 45, animEvery: 1 },
  high: { antialias: true, maxPixelRatio: 2, renderScale: 1, shadows: 'dynamic', shadowMapSize: 4096, softShadows: true, environment: true, maxFps: 60, animEvery: 1 },
};

export function readQuality(params: URLSearchParams): Quality {
  const raw = (params.get('quality') ?? 'high').toLowerCase();
  const level: QualityLevel = raw === 'low' || raw === 'tv' ? 'low' : raw === 'medium' ? 'medium' : 'high';
  return { level, ...PRESETS[level] };
}
