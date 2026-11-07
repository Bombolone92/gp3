import type { Layer } from './document';
import type { LayerStyle } from '../imaging/effects/types';

// Helpers for the layer style stored on `Layer.style` (see imaging/effects).
type Any = { enabled?: boolean };
const on = (fx: Any | undefined) => !!fx && fx.enabled !== false;
const some = (list: Any[] | undefined) => !!list?.some((f) => f && f.enabled !== false);
/** The layer's style when it is enabled and has at least one enabled effect. */
export function activeLayerStyle(l: Layer): LayerStyle | undefined {
  const s = l.style as LayerStyle | undefined;
  if (!s || s.enabled === false) return undefined;
  return some(s.dropShadow) || some(s.innerShadow) || on(s.outerGlow) || on(s.innerGlow) || on(s.bevel) || on(s.satin) ||
    some(s.colorOverlay) || some(s.gradientOverlay) || on(s.patternOverlay) || some(s.stroke)
    ? s
    : undefined;
}
// Projects can be edited by hand; clamp every size so a hostile value cannot
// allocate unbounded work buffers (sizes and distances are pixels).
const clampNum = (v: unknown, lo: number, hi: number, d: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;
export function sanitizeStyle(style: LayerStyle): LayerStyle {
  const s = structuredClone(style);
  s.scale = clampNum(s.scale, 0.01, 10, 1);
  const fix = (fx: Record<string, unknown> | undefined) => {
    if (!fx) return;
    for (const k of ['size', 'soften']) if (k in fx) fx[k] = clampNum(fx[k], 0, 250, 0);
    if ('distance' in fx) fx.distance = clampNum(fx.distance, 0, 1000, 0);
    for (const k of ['opacity', 'spread', 'range', 'jitter', 'noise', 'highlightOpacity', 'shadowOpacity'])
      if (k in fx) fx[k] = clampNum(fx[k], 0, 1, 0);
    if ('depth' in fx) fx.depth = clampNum(fx.depth, 0, 10, 1);
  };
  for (const list of [s.dropShadow, s.innerShadow, s.colorOverlay, s.gradientOverlay, s.stroke]) list?.forEach((fx) => fix(fx as never));
  for (const fx of [s.outerGlow, s.innerGlow, s.bevel, s.satin, s.patternOverlay]) fix(fx as never);
  return s;
}
