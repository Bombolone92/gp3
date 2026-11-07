/**
 * The pixel filter catalog: categories, filters and filter stacks (an
 * Effect Gallery record applies its stack in order).
 *
 * A stack layer is { filter, hidden?, ...params }.
 */
import { FILTERS_A } from './filters-a.js';
import { FILTERS_B } from './filters-b.js';
import { cleanParams } from './params.js';

export const CATEGORIES = [
  { id: 'artistic', label: 'Artistic' },
  { id: 'blur', label: 'Blur' },
  { id: 'strokes', label: 'Brush Strokes' },
  { id: 'distort', label: 'Distort' },
  { id: 'pixelate', label: 'Pixelate' },
  { id: 'sketch', label: 'Sketch' },
  { id: 'stylize', label: 'Stylize' },
  { id: 'texture', label: 'Texture' },
];

export const FILTERS = [...FILTERS_A, ...FILTERS_B];
export const FILTER = new Map(FILTERS.map((f) => [f.id, f]));

/** A clean stack layer, or null for an unknown filter. */
export function cleanLayer(l) {
  const f = l && FILTER.get(l.filter);
  if (!f) return null;
  return { filter: f.id, ...(l.hidden ? { hidden: true } : {}), ...cleanParams(f, l) };
}

export function newLayer(id, params = {}) {
  const f = FILTER.get(id);
  return f ? { filter: id, ...cleanParams(f, params) } : null;
}

/** Just the parameters of a layer. */
export function layerParams(l) {
  const { filter, hidden, ...p } = l;
  return p;
}

const visible = (stack) => (stack || []).filter((l) => l && !l.hidden && FILTER.has(l.filter));

function strHash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * Run a stack on an image. ctx: { k, ox, oy, seed, bounds }. Each layer
 * gets its own seed from the record's seed and the filter, so reordering
 * keeps every filter's randomness.
 */
export function runStack(img, stack, ctx) {
  const seen = new Map();
  let out = img;
  for (const l of visible(stack)) {
    const f = FILTER.get(l.filter);
    const n = seen.get(l.filter) || 0;
    seen.set(l.filter, n + 1);
    const seed = (((ctx.seed || 0) ^ strHash(l.filter)) + n * 7919) & 0x7fffffff;
    out = f.run(out, cleanParams(f, l), { ...ctx, seed });
  }
  return out;
}

/** How far (document units) a stack can paint past the object's bounds b. */
export function stackGrow(stack, b = null) {
  let d = 0;
  for (const l of visible(stack)) {
    const f = FILTER.get(l.filter);
    if (f.grow) d += f.grow(cleanParams(f, l), b && { x: b.x - d, y: b.y - d, w: b.w + 2 * d, h: b.h + 2 * d }) || 0;
  }
  return d;
}

/** How far (document units) a stack reads past each pixel. */
export function stackReach(stack) {
  let d = 0;
  for (const l of visible(stack)) {
    const f = FILTER.get(l.filter);
    const p = cleanParams(f, l);
    d += (f.reach ? f.reach(p) : 0) + (f.grow ? f.grow(p, null) : 0);
  }
  return d;
}

export function stackLabel(stack) {
  const v = visible(stack);
  if (v.length === 1) return FILTER.get(v[0].filter).label;
  return 'Effect Gallery';
}
