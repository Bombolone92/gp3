// Render > Flame, Picture Frame and Tree: procedural drawings composited over
// the image. Everything is deterministic for a given seed and laid out in
// document pixels (lengths scale with the preview scale).
import type { Mask8, NormPath, OperationContext, Progress, RGBA8 } from '../types';
import { clamp, copyImage, defineOp, hexColor, num, point, px, rng, str, tick } from './common';
import { fbm, permutation } from './render';
import { fillContours, type Contour } from './shape-blur';

type RGB = [number, number, number];

/** Paint `rgb` over a straight-alpha image through coverage (scaled by `alpha`). */
export function paintOver(img: RGBA8, x0: number, y0: number, cov: Mask8, rgb: RGB, alpha = 1) {
  const { width: W, data: d } = img;
  for (let y = 0; y < cov.height; y++)
    for (let x = 0; x < cov.width; x++) {
      const c = cov.data[y * cov.width + x];
      if (!c) continue;
      const a = (c / 255) * alpha, i = ((y0 + y) * W + x0 + x) * 4;
      const ba = d[i + 3] / 255, oa = a + ba * (1 - a);
      if (oa <= 0) continue;
      for (let k = 0; k < 3; k++) d[i + k] = (rgb[k] * a + d[i + k] * ba * (1 - a)) / oa;
      d[i + 3] = oa * 255;
    }
}
function fill(img: RGBA8, contours: Contour[], rgb: RGB, alpha = 1) {
  const t = fillContours(contours, img.width, img.height);
  if (t) paintOver(img, t.x, t.y, t.mask, rgb, alpha);
}
function ellipse(cx: number, cy: number, rx: number, ry: number, angle = 0, n = 0): Contour {
  const steps = n || Math.max(10, Math.min(48, Math.ceil(Math.max(rx, ry) * 1.5)));
  const c = Math.cos(angle), s = Math.sin(angle), out: Contour = [];
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * Math.PI * 2, ex = Math.cos(t) * rx, ey = Math.sin(t) * ry;
    out.push([cx + ex * c - ey * s, cy + ex * s + ey * c]);
  }
  return out;
}
const mixRGB = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const shade = (c: RGB, k: number): RGB => (k >= 0 ? mixRGB(c, [255, 255, 255], k) : mixRGB(c, [0, 0, 0], -k));

// ---------------------------------------------------------------------------
// Flame

/** Points along polylines (pixels) every `spacing`, with unit tangents. */
function pointsAlong(paths: NormPath[], w: number, h: number, spacing: number) {
  const out: { x: number; y: number }[] = [];
  for (const path of paths) {
    const pts = path.map((q) => [q.x * w, q.y * h]);
    if (pts.length === 1) {
      out.push({ x: pts[0][0], y: pts[0][1] });
      continue;
    }
    let carry = 0;
    out.push({ x: pts[0][0], y: pts[0][1] });
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
      const len = Math.hypot(bx - ax, by - ay);
      let t = spacing - carry;
      while (t <= len) {
        out.push({ x: ax + ((bx - ax) * t) / len, y: ay + ((by - ay) * t) / len });
        t += spacing;
      }
      carry = len - (t - spacing);
    }
  }
  return out;
}

const flameRamps: Record<string, RGB[]> = {
  natural: [[90, 10, 0], [200, 40, 0], [255, 120, 10], [255, 200, 60], [255, 248, 210]],
  blue: [[10, 20, 90], [20, 70, 220], [60, 150, 255], [150, 210, 255], [235, 248, 255]],
};
function ramp(stops: RGB[], t: number): RGB {
  const f = clamp(t, 0, 1) * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(f));
  return mixRGB(stops[i], stops[i + 1], f - i);
}

/** Flame intensity field over the image, in [0, 1]. */
export function flameField(w: number, h: number, paths: NormPath[], opts: { length: number; width: number; turbulence: number; jitter: number; seed: number }, progress?: Progress): Float32Array {
  const field = new Float32Array(w * h);
  const { length: L, width: W } = opts;
  if (L < 1 || W < 0.5) return field;
  const next = rng(opts.seed ^ 0x2f1a);
  const perm = permutation(opts.seed);
  const bases = pointsAlong(paths, w, h, Math.max(1, W * 0.4));
  const tongues = bases.map((b) => ({
    x: b.x + (next() - 0.5) * W * opts.jitter,
    y: b.y + (next() - 0.5) * W * 0.3 * opts.jitter,
    len: L * (1 - opts.jitter * 0.45 * next()),
    wid: W * (0.75 + 0.5 * next()),
    phase: next() * 100,
  }));
  for (let k = 0; k < tongues.length; k++) {
    if ((k & 7) === 0) tick(progress, k, tongues.length);
    const t = tongues[k];
    const x0 = Math.max(0, Math.floor(t.x - t.wid * 2 - t.len * 0.4)), x1 = Math.min(w, Math.ceil(t.x + t.wid * 2 + t.len * 0.4));
    const y0 = Math.max(0, Math.floor(t.y - t.len * 1.05)), y1 = Math.min(h, Math.ceil(t.y + t.wid * 0.6));
    for (let y = y0; y < y1; y++) {
      const v = (t.y - (y + 0.5)) / t.len; // 0 at the base, 1 at the tip
      if (v > 1) continue;
      const vv = Math.max(0, v);
      // The centerline sways more toward the tip.
      const sway = opts.turbulence * t.wid * 1.6 * vv * fbm(perm, vv * 2.5 + t.phase, t.phase * 0.37, 3);
      // Widest a little above the base, narrowing to a point at the tip, with
      // a rounded bottom just below the base.
      const cap = t.wid * 0.3, below = -v * t.len;
      const half = v < 0 ? cap * Math.sqrt(Math.max(0, 1 - (below / cap) ** 2)) : t.wid * 0.5 * Math.pow(1 - vv, 0.65) * Math.min(1, 0.6 + vv * 4);
      if (half <= 0.2) continue;
      const fade = v < 0 ? 1 - 0.5 * Math.min(1, below / cap) : Math.pow(1 - vv, 0.6);
      for (let x = x0; x < x1; x++) {
        const d = Math.abs(x + 0.5 - t.x - sway) / half;
        if (d >= 1) continue;
        const flick = 0.75 + 0.25 * fbm(perm, (x + 0.5) / Math.max(4, t.wid) + t.phase, (y + 0.5) / Math.max(4, t.wid * 2), 2);
        const val = (1 - d * d) * fade * flick;
        const i = y * w + x;
        // Overlapping tongues add up like light, saturating smoothly.
        field[i] = 1 - (1 - field[i]) * (1 - clamp(val, 0, 1) * 0.5);
      }
    }
  }
  return field;
}

export const flame = defineOp({
  id: 'flame',
  label: 'Flame',
  category: 'Render',
  params: [
    { key: 'paths', label: 'Flame Paths', type: 'paths', default: [[{ x: 0.5, y: 0.9 }, { x: 0.5, y: 0.78 }]], limit: 16 },
    { key: 'length', label: 'Length', type: 'number', min: 1, max: 2000, step: 1, default: 120, unit: 'px' },
    { key: 'width', label: 'Width', type: 'number', min: 1, max: 1000, step: 1, default: 40, unit: 'px' },
    { key: 'turbulence', label: 'Turbulence', type: 'number', min: 0, max: 100, step: 1, default: 40, unit: '%' },
    { key: 'jitter', label: 'Jitter', type: 'number', min: 0, max: 100, step: 1, default: 50, unit: '%' },
    {
      key: 'colors',
      label: 'Color',
      type: 'select',
      options: [{ value: 'natural', label: 'Natural' }, { value: 'blue', label: 'Blue' }, { value: 'custom', label: 'Custom Color' }],
      default: 'natural',
    },
    { key: 'color', label: 'Custom Color', type: 'color', default: '#38c46a' },
    { key: 'opacity', label: 'Opacity', type: 'number', min: 1, max: 100, step: 1, default: 100, unit: '%' },
  ],
  run(src, p, ctx, progress) {
    const { width: w, height: h } = src;
    const field = flameField(w, h, p.paths as NormPath[], {
      length: px(ctx, num(p, 'length')),
      width: px(ctx, num(p, 'width')),
      turbulence: num(p, 'turbulence') / 100,
      jitter: num(p, 'jitter') / 100,
      seed: ctx.seed ?? 0,
    }, progress);
    const style = str(p, 'colors');
    const stops = style === 'custom' ? (() => {
      const c = hexColor(str(p, 'color'));
      return [shade(c, -0.7), shade(c, -0.3), c, shade(c, 0.5), [255, 255, 255] as RGB];
    })() : flameRamps[style] ?? flameRamps.natural;
    const opacity = num(p, 'opacity') / 100;
    const out = copyImage(src), d = out.data;
    for (let i = 0, j = 0; i < field.length; i++, j += 4) {
      const f = field[i];
      if (f <= 0.002) continue;
      const col = ramp(stops, Math.pow(f, 1.3));
      // Screen the glow over existing color; it also adds coverage on transparency.
      const a = clamp(f * 2, 0, 1) * opacity, ba = d[j + 3] / 255, oa = a + ba * (1 - a);
      for (let k = 0; k < 3; k++) {
        // Half screen, half normal: glows on dark images, still reads on light ones.
        const base = d[j + k], scr = 255 - ((255 - base) * (255 - col[k])) / 255, target = (scr + col[k]) / 2;
        const lit = ba > 0 ? (base + (target - base) * a) * ba : 0;
        d[j + k] = oa > 0 ? (lit + col[k] * a * (1 - ba)) / oa : 0;
      }
      d[j + 3] = oa * 255;
    }
    return out;
  },
});

// ---------------------------------------------------------------------------
// Picture Frame

export type FrameStyle = 'beaded' | 'braided' | 'vine' | 'bevel' | 'scalloped';
/** Frame coordinates of a pixel: depth into the band (0 outer, 1 inner),
 * position along the frame side (px), which side (0 top, 1 right, 2 bottom,
 * 3 left) — sides meet in mitered corners. */
export function frameCoords(x: number, y: number, w: number, h: number, margin: number, width: number) {
  const dl = x - margin, dr = w - margin - x, dt = y - margin, db = h - margin - y;
  const m = Math.min(dl, dr, dt, db);
  if (m < 0 || m > width) return null;
  const side = m === dt ? 0 : m === dr ? 1 : m === db ? 2 : 3;
  const along = side === 0 ? x - margin : side === 1 ? y - margin : side === 2 ? w - margin - x : h - margin - y;
  return { u: m / width, along, side, depth: m };
}

function frameColor(style: FrameStyle, u: number, along: number, side: number, width: number, orn: number, c1: RGB, c2: RGB): [RGB, number] | null {
  const aa = 1 / Math.max(1, width); // about one pixel in u units
  const lightSide = side === 0 || side === 3 ? 0.25 : -0.25;
  switch (style) {
    case 'bevel': {
      // Four steps that alternately face the light and away from it.
      const step = Math.min(3, Math.floor(u * 4));
      const k = (step % 2 === 0 ? lightSide : -lightSide) * (1 - step * 0.15);
      const lip = u > 0.94 ? 0.35 : 0;
      return [step === 1 ? shade(mixRGB(c1, c2, 0.5), k) : shade(c1, k + lip), 1];
    }
    case 'beaded': {
      const base = shade(c1, lightSide * 0.4 * (1 - Math.abs(u - 0.5) * 2));
      const r = Math.max(1, width * 0.3 * orn), period = r * 2.4;
      const cx = (Math.floor(along / period) + 0.5) * period;
      const dx = along - cx, dy = (u - 0.5) * width;
      const dist = Math.hypot(dx, dy) / r;
      if (dist < 1 + aa * width / r) {
        const cover = clamp((1 - dist) * r + 0.5, 0, 1);
        // A small sphere lit from the upper left.
        const hl = clamp(1 - Math.hypot(dx + r * 0.35, dy + r * 0.35) / r, 0, 1);
        return [mixRGB(base, shade(c2, -0.35 * dist + hl * 0.7), cover), 1];
      }
      const rim = u < 0.1 || u > 0.9 ? -0.25 : 0;
      return [shade(base, rim), 1];
    }
    case 'braided': {
      const period = Math.max(4, width * 1.6 * orn);
      const phase = (along / period) * Math.PI * 2;
      const amp = 0.28, thick = 0.16;
      const yA = 0.5 + amp * Math.sin(phase), yB = 0.5 - amp * Math.sin(phase);
      const dA = Math.abs(u - yA) / thick, dB = Math.abs(u - yB) / thick;
      // Strands swap which one lies on top at every crossing.
      const aOnTop = Math.cos(phase) > 0;
      const order: [number, number][] = aOnTop ? [[dB, -0.15], [dA, 0.1]] : [[dA, -0.15], [dB, 0.1]];
      let col: RGB = shade(c1, -0.3 + lightSide * 0.3);
      for (const [d, k] of order) if (d < 1) col = mixRGB(col, shade(c2, k - d * d * 0.45), clamp((1 - d) * thick * width + 0.5, 0, 1));
      if (u < 0.06 || u > 0.94) col = shade(c1, lightSide);
      return [col, 1];
    }
    case 'vine': {
      let col: RGB = shade(c1, lightSide * 0.25);
      const period = Math.max(6, width * 1.4 * orn);
      const t = along / period;
      const stem = 0.5 + 0.12 * Math.sin(t * Math.PI * 2);
      const ds = Math.abs(u - stem) * width;
      if (ds < width * 0.035 + 0.5) col = mixRGB(col, shade(c2, -0.25), clamp(width * 0.035 + 0.5 - ds, 0, 1));
      // A leaf on alternating sides of the stem every half period.
      const k = Math.floor(t * 2), lt = (t * 2 - k) - 0.5, dir = k % 2 ? 1 : -1;
      const lx = lt * period * 0.5, ly = (u - stem) * width * dir;
      const L = period * 0.28, Wd = width * 0.16;
      const ex = (lx - L * 0.3) / L, ey = (ly - Wd * 1.1) / Wd;
      const e = Math.hypot(ex, ey);
      if (e < 1.05) col = mixRGB(col, shade(c2, 0.15 - e * 0.3 + (Math.abs(ey) < 0.08 ? -0.25 : 0)), clamp((1 - e) * Wd + 0.5, 0, 1));
      if (u < 0.05 || u > 0.95) col = shade(c1, lightSide * 0.6 - 0.1);
      return [col, 1];
    }
    case 'scalloped': {
      // A solid band whose inner edge is a row of half discs, with a dotted line.
      const period = Math.max(4, width * 0.9 * orn), r = Math.min(width * 0.6, period * 0.5);
      const cx = (Math.floor(along / period) + 0.5) * period;
      const depthPx = u * width, base = width - r;
      let cover = 1, dist = 0;
      if (depthPx > base) {
        dist = Math.hypot(along - cx, depthPx - base);
        cover = clamp(r - dist + 0.5, 0, 1);
        if (cover <= 0) return null;
      }
      let col: RGB = shade(c1, lightSide * 0.3);
      if (depthPx > base && r - dist < 1.5) col = shade(c2, -0.1);
      const dotR = Math.max(0.8, width * 0.07 * orn);
      const dd = Math.hypot(along - cx, depthPx - base * 0.5);
      if (dd < dotR + 0.5) col = mixRGB(col, shade(c2, 0.2), clamp(dotR + 0.5 - dd, 0, 1));
      if (u < 0.05) col = shade(c1, -0.35);
      return [col, cover];
    }
  }
}

export const pictureFrame = defineOp({
  id: 'picture-frame',
  label: 'Picture Frame',
  category: 'Render',
  params: [
    {
      key: 'style',
      label: 'Design',
      type: 'select',
      options: [
        { value: 'beaded', label: 'Beaded' },
        { value: 'braided', label: 'Braided' },
        { value: 'vine', label: 'Leafy Vine' },
        { value: 'bevel', label: 'Stepped Bevel' },
        { value: 'scalloped', label: 'Scalloped' },
      ],
      default: 'beaded',
    },
    { key: 'width', label: 'Frame Width', type: 'number', min: 2, max: 1000, step: 1, default: 40, unit: 'px' },
    { key: 'margin', label: 'Margin', type: 'number', min: 0, max: 1000, step: 1, default: 0, unit: 'px' },
    { key: 'ornament', label: 'Ornament Size', type: 'number', min: 20, max: 200, step: 1, default: 100, unit: '%' },
    { key: 'color', label: 'Frame Color', type: 'color', default: '#6e4a2a' },
    { key: 'accent', label: 'Ornament Color', type: 'color', default: '#e0b85a' },
  ],
  run(src, p, ctx, progress) {
    const { width: w, height: h } = src;
    const width = Math.max(1, px(ctx, num(p, 'width'))), margin = px(ctx, num(p, 'margin'));
    const style = str(p, 'style') as FrameStyle, orn = num(p, 'ornament') / 100;
    const c1 = hexColor(str(p, 'color')), c2 = hexColor(str(p, 'accent'));
    const out = copyImage(src), d = out.data;
    for (let y = 0; y < h; y++) {
      tick(progress, y, h);
      for (let x = 0; x < w; x++) {
        const f = frameCoords(x + 0.5, y + 0.5, w, h, margin, width);
        if (!f) continue;
        const r = frameColor(style, f.u, f.along, f.side, width, orn, c1, c2);
        if (!r) continue;
        // Soften the outer and inner edges of the band by about a pixel.
        const edge = clamp(Math.min(f.depth + 0.5, width - f.depth + 0.5), 0, 1);
        const a = r[1] * edge, i = (y * w + x) * 4, ba = d[i + 3] / 255, oa = a + ba * (1 - a);
        if (oa <= 0) continue;
        for (let k = 0; k < 3; k++) d[i + k] = (r[0][k] * a + d[i + k] * ba * (1 - a)) / oa;
        d[i + 3] = oa * 255;
      }
    }
    return out;
  },
});

// ---------------------------------------------------------------------------
// Tree

export type TreeParams = {
  baseX: number;
  baseY: number;
  height: number; // px
  angle: number; // branch spread, radians
  depth: number;
  thickness: number; // trunk width, px
  leaves: number; // 0..1
  leafSize: number; // px
  bend: number; // -1..1, positive leans right
  seed: number;
};
export type TreeShape = { branches: Contour[]; leaves: { x: number; y: number; rx: number; ry: number; angle: number; tone: number }[] };

/** Recursive branching: each branch spawns two or three shorter, thinner
 * children spread around its direction, bent by the wind; leaves gather at
 * the outer branches. */
export function growTree(t: TreeParams): TreeShape {
  const next = rng(t.seed ^ 0x7e3b);
  const out: TreeShape = { branches: [], leaves: [] };
  const trunkLen = t.height * 0.32;
  let budget = 6000; // branch cap keeps extreme settings bounded
  const grow = (x: number, y: number, dir: number, len: number, wid: number, level: number) => {
    if (budget-- <= 0) return;
    // Wind pushes branches toward its side, more the higher they are.
    const push = t.bend * 0.8 * (level / Math.max(1, t.depth));
    const bentDir = Math.atan2(Math.sin(dir), Math.cos(dir) + push);
    const dir2 = bentDir + t.bend * 0.12;
    const mx = x + Math.cos(bentDir) * len * 0.5, my = y + Math.sin(bentDir) * len * 0.5;
    const ex = mx + Math.cos(dir2) * len * 0.5, ey = my + Math.sin(dir2) * len * 0.5;
    const endW = wid * 0.68;
    // Tapered body through the midpoint, plus a round joint at the tip.
    const nx0 = -Math.sin(bentDir), ny0 = Math.cos(bentDir), nx1 = -Math.sin(dir2), ny1 = Math.cos(dir2);
    const mw = (wid + endW) / 4;
    out.branches.push([
      [x + nx0 * wid / 2, y + ny0 * wid / 2],
      [mx + nx0 * mw, my + ny0 * mw],
      [ex + nx1 * endW / 2, ey + ny1 * endW / 2],
      [ex - nx1 * endW / 2, ey - ny1 * endW / 2],
      [mx - nx0 * mw, my - ny0 * mw],
      [x - nx0 * wid / 2, y - ny0 * wid / 2],
    ]);
    if (endW > 1.2) out.branches.push(ellipse(ex, ey, endW / 2, endW / 2, 0, 12));
    const last = level >= t.depth;
    if (level >= t.depth - 1 && t.leaves > 0) {
      const count = Math.round((last ? 6 : 2) * t.leaves * (0.6 + next() * 0.8));
      for (let k = 0; k < count; k++) {
        const s = t.leafSize * (0.7 + next() * 0.6);
        const spread = len * 0.6 + s;
        out.leaves.push({
          x: ex + (next() - 0.5) * spread,
          y: ey + (next() - 0.5) * spread,
          rx: s,
          ry: s * (0.45 + next() * 0.2),
          angle: next() * Math.PI * 2,
          tone: next() * 2 - 1,
        });
      }
    }
    if (last || len < 1.5) return;
    const kids = next() < 0.3 ? 3 : 2;
    for (let k = 0; k < kids; k++) {
      const side = kids === 2 ? (k === 0 ? -1 : 1) : k - 1;
      const a = dir2 + side * t.angle * (0.7 + next() * 0.5) + (next() - 0.5) * 0.2;
      grow(ex, ey, a, len * (0.68 + next() * 0.14), endW * (kids === 3 && side === 0 ? 0.9 : 0.8), level + 1);
    }
  };
  grow(t.baseX, t.baseY, -Math.PI / 2, trunkLen, t.thickness, 1);
  return out;
}

export const tree = defineOp({
  id: 'tree',
  label: 'Tree',
  category: 'Render',
  params: [
    { key: 'base', label: 'Base Position', type: 'point', default: { x: 0.5, y: 0.95 } },
    { key: 'height', label: 'Height', type: 'number', min: 5, max: 150, step: 1, default: 70, unit: '%' },
    { key: 'angle', label: 'Branch Angle', type: 'number', min: 5, max: 80, step: 1, default: 28, unit: '°' },
    { key: 'depth', label: 'Branching Levels', type: 'number', min: 2, max: 10, step: 1, default: 7 },
    { key: 'thickness', label: 'Trunk Thickness', type: 'number', min: 1, max: 30, step: 0.5, default: 5, unit: '%' },
    { key: 'leaves', label: 'Leaf Amount', type: 'number', min: 0, max: 100, step: 1, default: 70, unit: '%' },
    { key: 'leafSize', label: 'Leaf Size', type: 'number', min: 1, max: 200, step: 1, default: 8, unit: 'px' },
    { key: 'bend', label: 'Wind', type: 'number', min: -100, max: 100, step: 1, default: 0, unit: '%' },
    { key: 'bark', label: 'Branch Color', type: 'color', default: '#5a3b22' },
    { key: 'leafColor', label: 'Leaf Color', type: 'color', default: '#3d8b3d' },
    { key: 'seed', label: 'Variation', type: 'number', min: 0, max: 9999, step: 1, default: 1 },
  ],
  run(src, p, ctx, progress) {
    const { width: w, height: h } = src;
    const b = point(p, 'base');
    const H = (num(p, 'height') / 100) * h;
    const shape = growTree({
      baseX: b.x * w,
      baseY: b.y * h,
      height: H,
      angle: (num(p, 'angle') * Math.PI) / 180,
      depth: Math.round(num(p, 'depth')),
      thickness: Math.max(0.5, (num(p, 'thickness') / 100) * H),
      leaves: num(p, 'leaves') / 100,
      leafSize: px(ctx as OperationContext, num(p, 'leafSize')),
      bend: num(p, 'bend') / 100,
      seed: Math.round(num(p, 'seed')),
    });
    const out = copyImage(src);
    const bark = hexColor(str(p, 'bark')), leaf = hexColor(str(p, 'leafColor'));
    const total = shape.branches.length + shape.leaves.length;
    let k = 0;
    for (const c of shape.branches) {
      if ((k++ & 31) === 0) tick(progress, k, total);
      fill(out, [c], bark);
    }
    for (const l of shape.leaves) {
      if ((k++ & 31) === 0) tick(progress, k, total);
      fill(out, [ellipse(l.x, l.y, l.rx, l.ry, l.angle)], shade(leaf, l.tone * 0.25), 0.92);
    }
    return out;
  },
});
