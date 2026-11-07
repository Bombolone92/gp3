/**
 * Color theory helpers for the Color Guide panel and Recolor with Preset:
 * harmony rules (hue relationships around a base color), variation grids
 * (tints and shades, warm and cool, vivid and muted), CIELAB distances for
 * limiting colors to a swatch library, and weighted k-means for reducing
 * artwork to a few colors.
 */
import { hexToRgb, rgbToHex, rgbToHsb, hsbToRgb, clamp } from '../../lib/color.js';

const hsb = (hex) => rgbToHsb(hexToRgb(hex));
const fromHsb = (h, s, v) => rgbToHex(hsbToRgb({ h: ((h % 360) + 360) % 360, s: clamp(s, 0, 100), v: clamp(v, 0, 100) }));

/**
 * Harmony rules. Hue rules list hue offsets in degrees from the base; tone
 * rules derive colors of the base hue.
 */
export const HARMONY_RULES = [
  { id: 'complementary', label: 'Complementary', hues: [0, 180] },
  { id: 'complementary-pair', label: 'Complementary Pairs', hues: [0, 30, 180, 210] },
  { id: 'split', label: 'Split Complementary', hues: [0, 150, 210] },
  { id: 'analogous', label: 'Analogous', hues: [-30, 0, 30] },
  { id: 'analogous-wide', label: 'Analogous Wide', hues: [-60, -30, 0, 30, 60] },
  { id: 'triad', label: 'Triad', hues: [0, 120, 240] },
  { id: 'tetrad', label: 'Tetrad (Rectangle)', hues: [0, 60, 180, 240] },
  { id: 'square', label: 'Square', hues: [0, 90, 180, 270] },
  { id: 'pentad', label: 'Pentad', hues: [0, 72, 144, 216, 288] },
  { id: 'accent', label: 'Analogous with Accent', hues: [-30, 0, 30, 180] },
  { id: 'monochrome', label: 'Monochrome', tones: (b) => [[b.s, b.v], [b.s * 0.55, Math.min(100, b.v + 15)], [Math.min(100, b.s + 20), b.v * 0.7], [b.s * 0.3, Math.min(100, b.v + 30)], [b.s, b.v * 0.45]] },
  { id: 'shades', label: 'Shades', tones: (b) => [1, 0.8, 0.6, 0.4, 0.2].map((k) => [b.s, b.v * k]) },
  { id: 'tints', label: 'Tints', tones: (b) => [1, 0.75, 0.5, 0.3, 0.12].map((k) => [b.s * k, b.v + (100 - b.v) * (1 - k)]) },
  { id: 'contrast', label: 'High Contrast', tones: (b) => [[b.s, b.v], [b.s, b.v > 50 ? b.v * 0.25 : Math.min(100, b.v + 60)]], extra: [180] },
];

export function ruleById(id) {
  return HARMONY_RULES.find((r) => r.id === id) || HARMONY_RULES[0];
}

/** The colors of a harmony rule around `base` (the base color itself included). */
export function harmonyColors(base, ruleId) {
  const rule = ruleById(ruleId);
  const b = hsb(base);
  if (rule.hues) {
    return rule.hues.map((o) => (o === 0 ? base.toLowerCase() : fromHsb(b.h + o, b.s, b.v)));
  }
  const out = rule.tones(b).map(([s, v]) => fromHsb(b.h, s, v));
  for (const o of rule.extra || []) out.push(fromHsb(b.h + o, b.s, b.v));
  out[0] = base.toLowerCase();
  return out;
}

/** Hue shift toward warm (orange, about 30°) or cool (blue, about 210°) by `t` (-1 cool .. 1 warm). */
function warmCool(hex, t) {
  const b = hsb(hex);
  const goal = t > 0 ? 30 : 210;
  const d = ((goal - b.h + 540) % 360) - 180;
  return fromHsb(b.h + d * Math.abs(t) * 0.5, b.s, b.v);
}

/**
 * A variation row for one color: `steps` colors on each side of it.
 *   'tints'      shades (darker) on the left, tints (lighter) on the right
 *   'warmCool'   cooler on the left, warmer on the right
 *   'vividMuted' muted (less saturated) on the left, vivid on the right
 * `amount` (0-100) scales how far the ends go.
 */
export function variationRow(hex, kind = 'tints', steps = 4, amount = 100) {
  const b = hsb(hex);
  const k = clamp(amount, 0, 100) / 100;
  const row = [];
  for (let i = -steps; i <= steps; i++) {
    const t = (i / steps) * k;
    if (i === 0) {
      row.push(hex.toLowerCase());
      continue;
    }
    if (kind === 'warmCool') row.push(warmCool(hex, t));
    else if (kind === 'vividMuted') row.push(t < 0 ? fromHsb(b.h, b.s * (1 + t), b.v) : fromHsb(b.h, b.s + (100 - b.s) * t, Math.min(100, b.v + (100 - b.v) * t * 0.3)));
    else row.push(t < 0 ? fromHsb(b.h, b.s, b.v * (1 + t)) : fromHsb(b.h, b.s * (1 - t), b.v + (100 - b.v) * t));
  }
  return row;
}

export const VARIATIONS = [
  { id: 'tints', label: 'Tints and Shades', left: 'Shades', right: 'Tints' },
  { id: 'warmCool', label: 'Warm and Cool', left: 'Cool', right: 'Warm' },
  { id: 'vividMuted', label: 'Vivid and Muted', left: 'Muted', right: 'Vivid' },
];

// ---- CIELAB ----

function lin(c) {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/** sRGB hex -> CIELAB (D65). */
export function hexToLab(hex) {
  const { r, g, b } = hexToRgb(hex);
  const R = lin(r);
  const G = lin(g);
  const B = lin(b);
  const x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return { l: 116 * f(y) - 16, a: 500 * (f(x) - f(y)), b: 200 * (f(y) - f(z)) };
}

export function labDistance(p, q) {
  return Math.hypot(p.l - q.l, p.a - q.a, p.b - q.b);
}

/** The palette color closest to `hex` (perceptually). */
export function nearestColor(hex, palette) {
  if (!palette.length) return hex;
  const p = hexToLab(hex);
  let best = palette[0];
  let bd = Infinity;
  for (const c of palette) {
    const d = labDistance(p, hexToLab(c));
    if (d < bd) {
      bd = d;
      best = c;
    }
  }
  return best.toLowerCase();
}

/**
 * Weighted k-means in CIELAB. colors: [{ color, count }]. Returns
 * { centers: [hex], assign: Map(hex -> center index) }. Deterministic: seeds
 * are the most used color and then the colors farthest from chosen seeds.
 */
export function clusterColors(colors, k) {
  const pts = colors.map((c) => ({ hex: c.color.toLowerCase(), w: c.count || 1, lab: hexToLab(c.color) }));
  if (!pts.length) return { centers: [], assign: new Map() };
  k = Math.max(1, Math.min(k, pts.length));
  const seeds = [pts.slice().sort((a, b) => b.w - a.w)[0].lab];
  while (seeds.length < k) {
    let far = null;
    let fd = -1;
    for (const p of pts) {
      const d = Math.min(...seeds.map((s) => labDistance(p.lab, s)));
      if (d > fd) {
        fd = d;
        far = p;
      }
    }
    seeds.push(far.lab);
  }
  let centers = seeds.map((s) => ({ ...s }));
  const assign = new Array(pts.length).fill(0);
  for (let iter = 0; iter < 20; iter++) {
    let moved = false;
    pts.forEach((p, i) => {
      let bi = 0;
      let bd = Infinity;
      centers.forEach((c, j) => {
        const d = labDistance(p.lab, c);
        if (d < bd) {
          bd = d;
          bi = j;
        }
      });
      if (assign[i] !== bi) moved = true;
      assign[i] = bi;
    });
    centers = centers.map((c, j) => {
      let w = 0;
      const sum = { l: 0, a: 0, b: 0 };
      pts.forEach((p, i) => {
        if (assign[i] !== j) return;
        w += p.w;
        sum.l += p.lab.l * p.w;
        sum.a += p.lab.a * p.w;
        sum.b += p.lab.b * p.w;
      });
      return w ? { l: sum.l / w, a: sum.a / w, b: sum.b / w } : c;
    });
    if (!moved && iter > 0) break;
  }
  // Each cluster is represented by its most used member (a real color from the art).
  const reps = centers.map((_, j) => {
    const members = pts.filter((p, i) => assign[i] === j).sort((a, b) => b.w - a.w);
    return members[0]?.hex || pts[0].hex;
  });
  const map = new Map(pts.map((p, i) => [p.hex, assign[i]]));
  return { centers: reps, assign: map };
}

/**
 * Recolor map that reduces colors to `k` hues: each color takes its
 * cluster's hue and saturation but keeps its own brightness, so shading
 * survives as tints and shades of the cluster color.
 */
export function reduceColorsMap(colors, k) {
  const { centers, assign } = clusterColors(colors, k);
  const out = {};
  for (const c of colors) {
    const hex = c.color.toLowerCase();
    const center = centers[assign.get(hex)];
    if (!center) continue;
    const cb = hsb(center);
    const own = hsb(hex);
    out[hex] = hex === center ? hex : fromHsb(cb.h, cb.s, own.v);
  }
  return out;
}

/**
 * Recolor map onto a harmony: the art's colors, ordered by hue, are spread
 * over the harmony colors; each keeps its brightness relative to the most
 * used color.
 */
export function harmonyMap(colors, ruleId) {
  if (!colors.length) return {};
  const base = colors[0].color;
  const targets = harmonyColors(base, ruleId);
  const { centers, assign } = clusterColors(colors, Math.min(targets.length, colors.length));
  const order = centers.map((c, i) => ({ i, h: hsb(c).h })).sort((a, b) => a.h - b.h);
  const baseV = hsb(base).v || 1;
  const out = {};
  for (const c of colors) {
    const hex = c.color.toLowerCase();
    const rank = order.findIndex((o) => o.i === assign.get(hex));
    const t = hsb(targets[Math.max(0, rank) % targets.length]);
    const own = hsb(hex);
    out[hex] = fromHsb(t.h, t.s, clamp(t.v * (own.v / baseV), 0, 100));
  }
  return out;
}

/** Recolor map snapping every color to its nearest color in a palette. */
export function paletteMap(colors, palette) {
  const out = {};
  for (const c of colors) out[c.color.toLowerCase()] = nearestColor(c.color, palette);
  return out;
}
