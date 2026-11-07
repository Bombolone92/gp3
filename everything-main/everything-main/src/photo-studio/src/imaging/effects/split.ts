import type { IRect, RGBA8 } from '../types';
import type { BlendMode } from '../blend/modes';
import { alphaBounds, renderLayerStyle, type LayerStyleOptions } from './render';
import type { LayerStyle } from './types';

// Splitting a layer style into separate images ("Create Layers"): each
// effect is rendered on its own over a transparent layer. Effects under the
// layer (shadows, outer glow) and over it (outside strokes, outer bevels)
// become free images; interior effects become images meant to be clipped to
// the layer, blended with the effect's own mode.
export type StylePiece = {
  // Effect key in LayerStyle (e.g. 'dropShadow', 'bevel') and which part.
  effect: string;
  index: number;
  part?: 'highlight' | 'shadow';
  stage: 'below' | 'interior' | 'above';
  mode: BlendMode;
  image: RGBA8;
  // Document position of the image (`origin` + render bounds).
  rect: IRect;
};

type Single = { key: keyof LayerStyle; index: number; part?: 'highlight' | 'shadow'; style: LayerStyle; mode: BlendMode };

/** The style's enabled effects, one style each, from bottom to top. */
function singles(style: LayerStyle): Single[] {
  const base: LayerStyle = { enabled: true, scale: style.scale, globalAngle: style.globalAngle, globalAltitude: style.globalAltitude };
  const out: Single[] = [];
  const add = (key: keyof LayerStyle, index: number, fx: { enabled: boolean; blendMode?: BlendMode } | undefined, list: boolean) => {
    if (!fx?.enabled) return;
    out.push({ key, index, style: { ...base, [key]: list ? [fx] : fx }, mode: fx.blendMode ?? 'normal' });
  };
  style.dropShadow?.forEach((fx, i) => add('dropShadow', i, fx, true));
  add('outerGlow', 0, style.outerGlow, false);
  add('satin', 0, style.satin, false);
  style.colorOverlay?.forEach((fx, i) => add('colorOverlay', i, fx, true));
  style.gradientOverlay?.forEach((fx, i) => add('gradientOverlay', i, fx, true));
  add('patternOverlay', 0, style.patternOverlay, false);
  add('innerGlow', 0, style.innerGlow, false);
  style.innerShadow?.forEach((fx, i) => add('innerShadow', i, fx, true));
  const bevel = style.bevel;
  if (bevel?.enabled) {
    // Highlights and shadows blend with different modes: one image each.
    out.push({ key: 'bevel', index: 0, part: 'highlight', style: { ...base, bevel: { ...bevel, shadowOpacity: 0 } }, mode: bevel.highlightMode });
    out.push({ key: 'bevel', index: 0, part: 'shadow', style: { ...base, bevel: { ...bevel, highlightOpacity: 0 } }, mode: bevel.shadowMode });
  }
  style.stroke?.forEach((fx, i) => add('stroke', i, fx, true));
  return out;
}

export function splitLayerStyle(layer: RGBA8, style: LayerStyle, opts: Omit<LayerStyleOptions, 'fillOpacity' | 'separatePasses'>): StylePiece[] {
  const origin = opts.origin ?? { x: 0, y: 0 };
  const pieces: StylePiece[] = [];
  for (const s of singles(style)) {
    const r = renderLayerStyle(layer, s.style, { ...opts, fillOpacity: 0, separatePasses: true });
    if (r.bounds.width <= 0 || r.bounds.height <= 0) continue;
    const rect = { x: r.bounds.x + origin.x, y: r.bounds.y + origin.y, width: r.bounds.width, height: r.bounds.height };
    const piece = (stage: StylePiece['stage'], mode: BlendMode, image: RGBA8) => {
      if (alphaBounds(image)) pieces.push({ effect: s.key, index: s.index, part: s.part, stage, mode, image, rect });
    };
    for (const p of r.passes ?? []) if (p.stage === 'below') piece('below', p.mode, p.image);
    piece('interior', s.mode, r.layer);
    for (const p of r.passes ?? []) if (p.stage === 'above') piece('above', p.mode, p.image);
  }
  return pieces;
}
