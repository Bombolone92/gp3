import type { BlendMode } from '../blend/modes';
import type { Gradient, GradientMethod, GradientType } from '../gradient/gradient';
import type { Contour } from './contour';

// Layer style model. Distances and sizes are document pixels (multiplied by
// LayerStyle.scale and the render scale); opacities, spread/choke, noise,
// range and jitter are fractions in [0, 1]; angles are degrees,
// counterclockwise with 0 pointing right (light coming from that direction).
export type RGB = [number, number, number];
type FxBase = { enabled: boolean; blendMode: BlendMode; opacity: number };

// Drop and inner shadows. The shadow falls away from the light: with light
// angle a and distance d the offset on screen (y down) is
// (-d cos a, +d sin a); a = 90 puts the shadow straight below, a = 120 below
// and to the right.
export type ShadowFx = FxBase & {
  color: RGB;
  angle: number;
  useGlobalLight: boolean;
  distance: number;
  // Spread (drop shadow) or choke (inner shadow): the fraction of `size`
  // spent growing the matte solidly before the rest is blurred.
  spread: number;
  size: number;
  contour?: Contour;
  antiAliased?: boolean;
  noise?: number;
  // Drop shadow only: the layer shape hides the shadow under it (default true).
  knockout?: boolean;
};
export type GlowFill = { type: 'color'; color: RGB } | { type: 'gradient'; gradient: Gradient; reverse?: boolean };
export type GlowFx = FxBase & {
  fill: GlowFill;
  // softer: blur-based falloff (rounded at corners); precise: exact distance.
  technique: 'softer' | 'precise';
  // Spread (outer) or choke (inner), as for shadows.
  spread: number;
  size: number;
  contour?: Contour;
  antiAliased?: boolean;
  // Which part of the falloff the contour spans: 0.5 is all of it, smaller
  // values push the contour toward the edge, larger values outward.
  range: number;
  // Randomizes the gradient lookup per pixel (gradient fills only).
  jitter: number;
  noise?: number;
  // Inner glow only: glow from the edges inward or from the center outward.
  source?: 'edge' | 'center';
};
export type BevelStyle = 'outer-bevel' | 'inner-bevel' | 'emboss' | 'pillow-emboss' | 'stroke-emboss';
export type BevelFx = {
  enabled: boolean;
  style: BevelStyle;
  // smooth: blurred profile; chisel-hard: exact distance (crisp ridges);
  // chisel-soft: exact distance, slightly softened.
  technique: 'smooth' | 'chisel-hard' | 'chisel-soft';
  // Slope multiplier, 1 = 100% (a 45 degree bevel for chisel techniques).
  depth: number;
  direction: 'up' | 'down';
  size: number;
  soften: number;
  angle: number;
  altitude: number;
  useGlobalLight: boolean;
  glossContour?: Contour;
  glossAntiAliased?: boolean;
  highlightMode: BlendMode;
  highlightColor: RGB;
  highlightOpacity: number;
  shadowMode: BlendMode;
  shadowColor: RGB;
  shadowOpacity: number;
  // Profile contour across the bevel (the "Contour" sub-effect).
  contour?: { contour: Contour; range: number; antiAliased?: boolean };
  // Bump texture from a pattern's luminance; depth -10..10 (1 = 100%).
  texture?: { patternId: string; scale: number; depth: number; invert?: boolean; linkWithLayer?: boolean; offset?: { x: number; y: number } };
};
export type SatinFx = FxBase & {
  color: RGB;
  angle: number;
  distance: number;
  size: number;
  contour?: Contour;
  antiAliased?: boolean;
  invert: boolean;
};
export type ColorOverlayFx = FxBase & { color: RGB };
// Geometry: the gradient spans the reference rectangle (layer content bounds
// when aligned with the layer, else the document) along `angle`, centered
// and shifted by `offset` (fractions of the rectangle size), scaled by `scale`.
export type GradientGeometry = {
  style: GradientType;
  angle: number;
  scale: number;
  reverse?: boolean;
  dither?: boolean;
  alignWithLayer?: boolean;
  offset?: { x: number; y: number };
  method?: GradientMethod;
};
export type GradientOverlayFx = FxBase & GradientGeometry & { gradient: Gradient };
export type PatternPlacement = {
  patternId: string;
  scale: number;
  angle?: number;
  // Tile origin at the layer content's top-left instead of the document's.
  linkWithLayer?: boolean;
  offset?: { x: number; y: number };
};
export type PatternOverlayFx = FxBase & PatternPlacement;
export type StrokeFill =
  | { type: 'color'; color: RGB }
  // shape-burst runs the gradient across the stroke from its inner edge (0)
  // to its outer edge (1).
  | ({ type: 'gradient'; gradient: Gradient } & Omit<GradientGeometry, 'style'> & { style: GradientType | 'shape-burst' })
  | ({ type: 'pattern' } & PatternPlacement);
export type StrokeFx = FxBase & { size: number; position: 'outside' | 'inside' | 'center'; fill: StrokeFill };

// Arrays (drop shadows, inner shadows, overlays, strokes) are drawn in index
// order: index 0 lowest.
export type LayerStyle = {
  enabled: boolean;
  // Scales every pixel-sized parameter ("scale effects").
  scale?: number;
  // Shared light for effects with useGlobalLight (defaults 120 and 30).
  globalAngle?: number;
  globalAltitude?: number;
  dropShadow?: ShadowFx[];
  innerShadow?: ShadowFx[];
  outerGlow?: GlowFx;
  innerGlow?: GlowFx;
  bevel?: BevelFx;
  satin?: SatinFx;
  colorOverlay?: ColorOverlayFx[];
  gradientOverlay?: GradientOverlayFx[];
  patternOverlay?: PatternOverlayFx;
  stroke?: StrokeFx[];
};

// Defaults for new effects, matching what users of raster editors expect.
export const defaultDropShadow = (): ShadowFx => ({
  enabled: true, blendMode: 'multiply', opacity: 0.35, color: [0, 0, 0], angle: 120, useGlobalLight: true,
  distance: 5, spread: 0, size: 5, knockout: true, antiAliased: false, noise: 0,
});
export const defaultInnerShadow = (): ShadowFx => ({
  enabled: true, blendMode: 'multiply', opacity: 0.35, color: [0, 0, 0], angle: 120, useGlobalLight: true,
  distance: 5, spread: 0, size: 5, antiAliased: false, noise: 0,
});
export const defaultOuterGlow = (): GlowFx => ({
  enabled: true, blendMode: 'screen', opacity: 0.35, fill: { type: 'color', color: [255, 255, 190] },
  technique: 'softer', spread: 0, size: 5, range: 0.5, jitter: 0, noise: 0,
});
export const defaultInnerGlow = (): GlowFx => ({ ...defaultOuterGlow(), source: 'edge' });
export const defaultBevel = (): BevelFx => ({
  enabled: true, style: 'inner-bevel', technique: 'smooth', depth: 1, direction: 'up', size: 5, soften: 0,
  angle: 120, altitude: 30, useGlobalLight: true, highlightMode: 'screen', highlightColor: [255, 255, 255],
  highlightOpacity: 0.75, shadowMode: 'multiply', shadowColor: [0, 0, 0], shadowOpacity: 0.75,
});
export const defaultSatin = (): SatinFx => ({
  enabled: true, blendMode: 'multiply', opacity: 0.5, color: [0, 0, 0], angle: 19, distance: 11, size: 14,
  invert: true, antiAliased: true,
});
export const defaultColorOverlay = (): ColorOverlayFx => ({ enabled: true, blendMode: 'normal', opacity: 1, color: [255, 0, 0] });
export const defaultStroke = (): StrokeFx => ({
  enabled: true, blendMode: 'normal', opacity: 1, size: 3, position: 'outside', fill: { type: 'color', color: [0, 0, 0] },
});
