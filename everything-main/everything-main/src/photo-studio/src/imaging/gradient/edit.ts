import type { RGB } from './color';
import {
  gradientRamp,
  RAMP_SIZE,
  sampleSolid,
  type ColorStop,
  type Gradient,
  type GradientContext,
  type OpacityStop,
  type SolidGradient,
  type StopColor,
} from './gradient';

// Editing helpers for the gradient editor. All return new gradients; stop
// arrays are kept sorted by location so indices match what the editor shows.
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const byLocation = (a: { location: number }, b: { location: number }) => a.location - b.location;
export type StopKind = 'color' | 'opacity';

// Color and opacity at `location`: [r, g, b, a] as 0..255 floats.
export function sampleGradient(g: Gradient, location: number, ctx: GradientContext = {}): number[] {
  const t = clamp01(location);
  if (g.kind === 'solid') {
    const sorted: SolidGradient = { ...g, colorStops: [...g.colorStops].sort(byLocation), opacityStops: [...g.opacityStops].sort(byLocation) };
    return sampleSolid(sorted, ctx.reverse ? 1 - t : t, ctx);
  }
  const ramp = gradientRamp(g, ctx);
  const k = Math.round(t * (RAMP_SIZE - 1)) * 4;
  return [ramp[k], ramp[k + 1], ramp[k + 2], ramp[k + 3]];
}

// Inserts a color stop; its color defaults to the gradient's color there so
// the gradient's look does not change until the user edits the new stop.
export function insertColorStop(g: SolidGradient, location: number, color?: StopColor, ctx: GradientContext = {}) {
  const loc = clamp01(location);
  const c = color ?? (sampleGradient(g, loc, { ...ctx, reverse: false }).slice(0, 3).map(Math.round) as RGB);
  const stop: ColorStop = { location: loc, color: c, midpoint: 50 };
  const colorStops = [...g.colorStops, stop].sort(byLocation);
  return { gradient: { ...g, colorStops }, index: colorStops.indexOf(stop) };
}
export function insertOpacityStop(g: SolidGradient, location: number, opacity?: number) {
  const loc = clamp01(location);
  const o = opacity ?? sampleGradient(g, loc)[3] / 255;
  const stop: OpacityStop = { location: loc, opacity: clamp01(o), midpoint: 50 };
  const opacityStops = [...g.opacityStops, stop].sort(byLocation);
  return { gradient: { ...g, opacityStops }, index: opacityStops.indexOf(stop) };
}
// Moves a stop and returns its new index after re-sorting.
export function moveStop(g: SolidGradient, kind: StopKind, index: number, location: number) {
  const key = kind === 'color' ? 'colorStops' : 'opacityStops';
  const stops = [...g[key]] as (ColorStop | OpacityStop)[];
  if (!stops[index]) return { gradient: g, index };
  const moved = { ...stops[index], location: clamp01(location) };
  stops[index] = moved;
  stops.sort(byLocation);
  return { gradient: { ...g, [key]: stops } as SolidGradient, index: stops.indexOf(moved) };
}
// Deletes a stop unless only two of that kind remain (a gradient needs both ends).
export function deleteStop(g: SolidGradient, kind: StopKind, index: number): SolidGradient {
  const key = kind === 'color' ? 'colorStops' : 'opacityStops';
  if (g[key].length <= 2 || !g[key][index]) return g;
  return { ...g, [key]: g[key].filter((_, i) => i !== index) };
}
export function setStopColor(g: SolidGradient, index: number, color: StopColor): SolidGradient {
  return { ...g, colorStops: g.colorStops.map((s, i) => (i === index ? { ...s, color } : s)) };
}
export function setStopOpacity(g: SolidGradient, index: number, opacity: number): SolidGradient {
  return { ...g, opacityStops: g.opacityStops.map((s, i) => (i === index ? { ...s, opacity: clamp01(opacity) } : s)) };
}
// Midpoint between stop `index` and the next, in percent, clamped to 5..95.
export function setMidpoint(g: SolidGradient, kind: StopKind, index: number, midpoint: number): SolidGradient {
  const key = kind === 'color' ? 'colorStops' : 'opacityStops';
  const m = Math.min(95, Math.max(5, midpoint));
  return { ...g, [key]: g[key].map((s, i) => (i === index ? { ...s, midpoint: m } : s)) } as SolidGradient;
}
// Mirrors stop locations; midpoints flip so each segment keeps its shape.
export function reverseGradient(g: SolidGradient): SolidGradient {
  const flip = <T extends { location: number; midpoint?: number }>(stops: T[]): T[] => {
    const s = [...stops].sort(byLocation);
    return s
      .map((stop, i) => ({ ...stop, location: 1 - stop.location, midpoint: i > 0 ? 100 - (s[i - 1].midpoint ?? 50) : 50 }))
      .reverse();
  };
  return { ...g, colorStops: flip(g.colorStops), opacityStops: flip(g.opacityStops) };
}
// Spaces stops evenly between the first and last, keeping order.
export function distributeStops(g: SolidGradient, kind: StopKind): SolidGradient {
  const key = kind === 'color' ? 'colorStops' : 'opacityStops';
  const s = [...g[key]].sort(byLocation) as (ColorStop | OpacityStop)[];
  if (s.length < 3) return g;
  const a = s[0].location, b = s[s.length - 1].location;
  return { ...g, [key]: s.map((stop, i) => ({ ...stop, location: a + ((b - a) * i) / (s.length - 1) })) } as SolidGradient;
}
// CSS preview string for swatches (sampled, so methods and midpoints show).
export function gradientToCss(g: Gradient, ctx: GradientContext = {}, angleDeg = 90, samples = 16): string {
  const parts: string[] = [];
  for (let i = 0; i <= samples; i++) {
    const [r, gg, b, a] = sampleGradient(g, i / samples, ctx);
    parts.push(`rgba(${Math.round(r)}, ${Math.round(gg)}, ${Math.round(b)}, ${+(a / 255).toFixed(3)}) ${+((i / samples) * 100).toFixed(2)}%`);
  }
  return `linear-gradient(${angleDeg}deg, ${parts.join(', ')})`;
}
