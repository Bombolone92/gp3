/**
 * Lens flares as live artwork: a leaf node of type 'flare' whose
 * parameters describe a bright center, a halo around it, rays streaking
 * out of it and rings strung along the line from the center to an end
 * point. The artwork is generated (circles and ray wedges with
 * transparent gradients), so the flare stays editable: move its center or
 * end point, or change its options, and it is rebuilt. Random sizes come
 * from the flare's own seed, so a flare always draws the same way.
 *
 *   { type: 'flare', cx, cy, ex, ey, color, seed,
 *     center: { diameter, opacity, brightness },
 *     halo: { growth, fuzziness },
 *     rays: { on, number, longest, fuzziness },
 *     rings: { on, path, number, largest, direction } }
 *
 * Percentages are stored as 0..100; `rings.path` and `rings.direction`
 * describe the end point for new flares (the stored end point wins after).
 */
import { uid } from '../../lib/ids.js';
import { hexToRgb, rgbToHex } from '../../lib/color.js';
import { KAPPA } from '../../model/shapes.js';

export const FLARE_DEFAULTS = Object.freeze({
  center: Object.freeze({ diameter: 100, opacity: 50, brightness: 30 }),
  halo: Object.freeze({ growth: 20, fuzziness: 50 }),
  rays: Object.freeze({ on: true, number: 15, longest: 300, fuzziness: 100 }),
  rings: Object.freeze({ on: true, path: 300, number: 10, largest: 50, direction: 45 }),
  color: '#ffffff',
});

export const isFlare = (n) => n?.type === 'flare';

/** Options merged with defaults. */
export function flareOptions(o = {}) {
  return {
    center: { ...FLARE_DEFAULTS.center, ...(o.center || {}) },
    halo: { ...FLARE_DEFAULTS.halo, ...(o.halo || {}) },
    rays: { ...FLARE_DEFAULTS.rays, ...(o.rays || {}) },
    rings: { ...FLARE_DEFAULTS.rings, ...(o.rings || {}) },
    color: o.color || FLARE_DEFAULTS.color,
  };
}

/** The end point a flare's ring path and direction give from its center. */
export function endFromOptions(cx, cy, rings) {
  const a = ((rings.direction || 0) * Math.PI) / 180;
  return { ex: cx + Math.cos(a) * rings.path, ey: cy - Math.sin(a) * rings.path };
}

/** A new flare node. */
export function createFlare(cx, cy, opts = {}, end = null, extra = {}) {
  const o = flareOptions(opts);
  const e = end || endFromOptions(cx, cy, o.rings);
  return { id: uid('f'), type: 'flare', name: '', cx, cy, ex: e.ex, ey: e.ey, seed: Math.floor(Math.random() * 2 ** 31), ...o, opacity: 1, blendMode: 'normal', effects: [], hidden: false, locked: false, ...extra };
}

/** Small deterministic random generator (mulberry32). */
export function rng(seed) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function circle(cx, cy, r) {
  const k = KAPPA * r;
  return [
    { x: cx, y: cy - r, ix: cx - k, iy: cy - r, ox: cx + k, oy: cy - r },
    { x: cx + r, y: cy, ix: cx + r, iy: cy - k, ox: cx + r, oy: cy + k },
    { x: cx, y: cy + r, ix: cx + k, iy: cy + r, ox: cx - k, oy: cy + r },
    { x: cx - r, y: cy, ix: cx - r, iy: cy + k, ox: cx - r, oy: cy - k },
  ];
}

const pt = (x, y) => ({ x, y, ix: x, iy: y, ox: x, oy: y });

function shade(hex, t, toward = '#000000') {
  const a = hexToRgb(hex);
  const b = hexToRgb(toward);
  return rgbToHex({ r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t });
}

const radial = (stops, x1, y1, r) => ({ type: 'radial', stops, x1, y1, x2: x1 + Math.max(r, 1e-3), y2: y1 });

/**
 * The parts of a flare in paint order: [{ role, anchors, closed, fill }]
 * with document-space radial and linear gradients.
 */
export function flareParts(f) {
  const o = flareOptions(f);
  const rand = rng(f.seed || 1);
  const parts = [];
  const { cx, cy } = f;
  const R = Math.max(0.5, o.center.diameter / 2);
  const col = o.color;
  // Rays and rings read on light and dark grounds: a touch darker than the center color.
  const mid = shade(col, 0.25, '#808080');
  // Halo: a soft ring around the center.
  const haloR = R * (1 + (o.halo.growth / 100) * 4);
  const fuzz = Math.max(0, Math.min(1, o.halo.fuzziness / 100));
  const inner = Math.max(0, 0.55 - fuzz * 0.45);
  const peak = Math.min(0.97, inner + 0.12 + (1 - fuzz) * 0.25);
  parts.push({
    role: 'halo',
    anchors: circle(cx, cy, haloR),
    closed: true,
    fill: radial(
      [
        { offset: 0, color: col, opacity: 0 },
        { offset: inner, color: col, opacity: 0 },
        { offset: peak, color: mid, opacity: 0.35 + (1 - fuzz) * 0.3 },
        { offset: 1, color: mid, opacity: 0 },
      ],
      cx,
      cy,
      haloR,
    ),
  });
  // Rays: thin wedges of random length fading toward their tips.
  if (o.rays.on && o.rays.number > 0) {
    const n = Math.round(o.rays.number);
    const avg = haloR * 1.15;
    const longest = Math.max(1, o.rays.longest / 100);
    const rf = Math.max(0, Math.min(1, o.rays.fuzziness / 100));
    const longIndex = Math.floor(rand() * n);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + (rand() - 0.5) * ((Math.PI * 2) / n) * 0.8;
      const len = i === longIndex ? avg * longest : avg * (0.35 + rand() * Math.min(1.4, longest * 0.45));
      const half = R * (0.012 + rf * 0.035) * (0.6 + rand() * 0.8);
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      const tip = { x: cx + dx * len, y: cy + dy * len };
      parts.push({
        role: 'ray',
        anchors: [pt(cx - dy * half, cy + dx * half), pt(tip.x, tip.y), pt(cx + dy * half, cy - dx * half)],
        closed: true,
        fill: {
          type: 'linear',
          stops: [
            { offset: 0, color: mid, opacity: 0.85 },
            { offset: 0.35 + (1 - rf) * 0.3, color: mid, opacity: 0.4 },
            { offset: 1, color: mid, opacity: 0 },
          ],
          x1: cx,
          y1: cy,
          x2: tip.x,
          y2: tip.y,
        },
      });
    }
  }
  // Center: a bright core fading out; brightness keeps the core solid further out.
  const bright = Math.max(0, Math.min(1, o.center.brightness / 100));
  const op = Math.max(0, Math.min(1, o.center.opacity / 100));
  parts.push({
    role: 'center',
    anchors: circle(cx, cy, R),
    closed: true,
    fill: radial(
      [
        { offset: 0, color: col, opacity: Math.min(1, op + 0.35) },
        { offset: Math.max(0.05, bright * 0.8), color: col, opacity: op },
        { offset: 1, color: col, opacity: 0 },
      ],
      cx,
      cy,
      R,
    ),
  });
  // Rings along the line from the center to the end point.
  if (o.rings.on && o.rings.number > 0) {
    const n = Math.round(o.rings.number);
    const largest = Math.max(0.01, o.rings.largest / 100);
    const ex = f.ex ?? cx;
    const ey = f.ey ?? cy;
    const rings = [];
    for (let i = 0; i < n; i++) {
      const t = i === n - 1 ? 1 : 0.15 + rand() * 0.95;
      const r = Math.max(0.5, R * largest * (i === 0 ? 1 : 0.12 + rand() * 0.88));
      const filled = rand() < 0.45;
      rings.push({ t, r, filled });
    }
    rings.sort((a, b) => b.r - a.r);
    for (const g of rings) {
      const x = cx + (ex - cx) * g.t;
      const y = cy + (ey - cy) * g.t;
      const stops = g.filled
        ? [
            { offset: 0, color: mid, opacity: 0.18 },
            { offset: 0.85, color: mid, opacity: 0.22 },
            { offset: 1, color: mid, opacity: 0 },
          ]
        : [
            { offset: 0, color: mid, opacity: 0 },
            { offset: 0.72, color: mid, opacity: 0.04 },
            { offset: 0.9, color: mid, opacity: 0.4 },
            { offset: 1, color: mid, opacity: 0 },
          ];
      parts.push({ role: 'ring', anchors: circle(x, y, g.r), closed: true, fill: radial(stops, x, y, g.r) });
    }
  }
  return parts;
}

/** Parameters moved by a matrix: center and end points, sizes scaled by the matrix's scale. */
export function transformFlare(f, m) {
  const s = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
  const P = (x, y) => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });
  const c = P(f.cx, f.cy);
  const e = P(f.ex, f.ey);
  const o = flareOptions(f);
  return { cx: c.x, cy: c.y, ex: e.x, ey: e.y, center: { ...o.center, diameter: o.center.diameter * s }, rings: { ...o.rings, path: o.rings.path * s } };
}
