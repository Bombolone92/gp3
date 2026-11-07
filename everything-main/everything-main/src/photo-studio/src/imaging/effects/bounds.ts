// Geometry of layer styles that the compositor needs without rendering them:
// how far effects reach beyond the layer, and where gradients run.
import type { IRect } from '../types';
import type { GradientGeometry, LayerStyle } from './types';

export type Expansion = { left: number; top: number; right: number; bottom: number };

const rad = (deg: number) => (deg * Math.PI) / 180;
const on = <T extends { enabled: boolean }>(fx: T | undefined): fx is T => !!fx && fx.enabled;
const list = <T extends { enabled: boolean }>(fx: T[] | undefined): T[] => (fx ?? []).filter((f) => f.enabled);

// How far the style's effects can reach beyond the layer content, in pixels.
export function styleBoundsExpansion(style: LayerStyle, renderScale = 1): Expansion {
  const e: Expansion = { left: 0, top: 0, right: 0, bottom: 0 };
  if (!style.enabled) return e;
  const k = (style.scale ?? 1) * renderScale;
  const grow = (l: number, t: number, r: number, b: number) => {
    e.left = Math.max(e.left, Math.ceil(l));
    e.top = Math.max(e.top, Math.ceil(t));
    e.right = Math.max(e.right, Math.ceil(r));
    e.bottom = Math.max(e.bottom, Math.ceil(b));
  };
  for (const fx of list(style.dropShadow)) {
    const a = rad(fx.useGlobalLight ? (style.globalAngle ?? 120) : fx.angle);
    const reach = fx.size * k + 2;
    const dx = Math.round(-Math.cos(a) * fx.distance * k), dy = Math.round(Math.sin(a) * fx.distance * k);
    grow(reach - dx, reach - dy, reach + dx, reach + dy);
  }
  if (on(style.outerGlow)) {
    const r = style.outerGlow.size * k + 2;
    grow(r, r, r, r);
  }
  if (on(style.bevel) && style.bevel.style !== 'inner-bevel') {
    const r = (style.bevel.size + style.bevel.soften) * k + 2;
    grow(r, r, r, r);
  }
  for (const s of list(style.stroke)) {
    if (s.position === 'inside') continue;
    const r = (s.position === 'outside' ? s.size : s.size / 2) * k + 2;
    grow(r, r, r, r);
  }
  return e;
}

// Start and end points of a gradient geometry spanning `rect` (also used by
// gradient fill layers, so overlays and fills place gradients alike).
export function gradientGeometryPoints(rect: IRect, g: Pick<GradientGeometry, 'style' | 'angle' | 'scale' | 'offset'>) {
  const a = rad(g.angle), ux = Math.cos(a), uy = -Math.sin(a);
  const half = ((Math.abs(rect.width * ux) + Math.abs(rect.height * uy)) / 2) * Math.max(0.01, g.scale);
  const cx = rect.x + rect.width / 2 + (g.offset?.x ?? 0) * rect.width;
  const cy = rect.y + rect.height / 2 + (g.offset?.y ?? 0) * rect.height;
  const linear = g.style === 'linear';
  const start = linear ? { x: cx - ux * half, y: cy - uy * half } : { x: cx, y: cy };
  const end = { x: cx + ux * half, y: cy + uy * half };
  return { start, end };
}
