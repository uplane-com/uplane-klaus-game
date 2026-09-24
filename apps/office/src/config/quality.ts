/**
 * Render quality presets, chosen with `?quality=low|medium|high` (default high).
 * `low` is meant for weak signage players (Fire TV / Signage Stick, Chromecast,
 * Android TV boxes): it renders fewer pixels, drops shadows and reflections,
 * caps the frame rate and animates characters less often.
 */
export type QualityLevel = 'low' | 'medium' | 'high';

export interface Quality {
  level: QualityLevel;
  antialias: boolean;
  /** Upper limit for devicePixelRatio. */
  maxPixelRatio: number;
  /** Fraction of the (capped) pixel ratio actually rendered; the canvas is scaled up. */
  renderScale: number;
  shadows: boolean;
  shadowMapSize: number;
  softShadows: boolean;
  /** Image-based reflections (glass, cars, water). */
  environment: boolean;
  maxFps: number;
  /** Advance character skeletons every N frames (1 = every frame). */
  animEvery: number;
}

const PRESETS: Record<QualityLevel, Omit<Quality, 'level'>> = {
  low: { antialias: false, maxPixelRatio: 1, renderScale: 0.67, shadows: false, shadowMapSize: 1024, softShadows: false, environment: false, maxFps: 30, animEvery: 2 },
  medium: { antialias: false, maxPixelRatio: 1, renderScale: 0.85, shadows: true, shadowMapSize: 2048, softShadows: false, environment: true, maxFps: 45, animEvery: 1 },
  high: { antialias: true, maxPixelRatio: 2, renderScale: 1, shadows: true, shadowMapSize: 4096, softShadows: true, environment: true, maxFps: 120, animEvery: 1 },
};

export function readQuality(params: URLSearchParams): Quality {
  const raw = (params.get('quality') ?? 'high').toLowerCase();
  const level: QualityLevel = raw === 'low' || raw === 'tv' ? 'low' : raw === 'medium' ? 'medium' : 'high';
  return { level, ...PRESETS[level] };
}
