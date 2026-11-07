// Type on a path and inside a closed path.
//
// Path text is laid out as one straight point-text block (x along the line,
// y across it, first baseline at y = 0) and then bent onto the path: a
// straight point (x, y) lands at distance `x` along the path from the start
// marker, offset `y` along the path's normal. Glyphs stay rigid; each is
// rotated to the chord of the path under its advance, which reads better on
// tight curves than the tangent at one point. Caret, selection and hit
// testing keep using the straight layout through `map` and `unmap`.
//
// Area text uses the same flattened outline to find, for each line band, the
// horizontal spans inside the shape (see `shapeSpans`).

import type { Decoration, GlyphRun, LayoutOptions, Rect, TextLayout } from './layout';
import type { TextLayerData, TypePath } from './model';

export type PathGeometry = {
  xs: Float64Array;
  ys: Float64Array;
  cum: Float64Array; // arc length at each vertex
  length: number;
  closed: boolean;
};

const cubicAt = (p0: number, p1: number, p2: number, p3: number, t: number) => {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
};

// Knots in the opposite direction (in and out handles swap). A closed path
// keeps its first knot, so fraction f of its length becomes 1 - f.
export function reverseKnots(knots: number[][], closed = false): number[][] {
  const flip = (k: number[]) => [k[4], k[5], k[2], k[3], k[0], k[1]];
  const rev = knots.slice().reverse().map(flip);
  if (closed && rev.length) rev.unshift(rev.pop()!);
  return rev;
}

// Polyline approximation of a cubic knot path with cumulative lengths.
export function pathGeometry(knots: number[][], closed: boolean): PathGeometry {
  const xs: number[] = [],
    ys: number[] = [];
  const n = knots.length;
  if (n) {
    xs.push(knots[0][2]);
    ys.push(knots[0][3]);
  }
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = knots[i],
      b = knots[(i + 1) % n];
    const ax = a[2], ay = a[3], c1x = a[4], c1y = a[5], c2x = b[0], c2y = b[1], bx = b[2], by = b[3];
    const hull = Math.hypot(c1x - ax, c1y - ay) + Math.hypot(c2x - c1x, c2y - c1y) + Math.hypot(bx - c2x, by - c2y);
    const straight = c1x === ax && c1y === ay && c2x === bx && c2y === by;
    const steps = straight ? 1 : Math.max(4, Math.min(512, Math.ceil(hull / 2)));
    for (let k = 1; k <= steps; k++) {
      const t = k / steps;
      xs.push(cubicAt(ax, c1x, c2x, bx, t));
      ys.push(cubicAt(ay, c1y, c2y, by, t));
    }
  }
  const m = xs.length;
  const cum = new Float64Array(m);
  for (let i = 1; i < m; i++) cum[i] = cum[i - 1] + Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]);
  return { xs: Float64Array.from(xs), ys: Float64Array.from(ys), cum, length: m ? cum[m - 1] : 0, closed };
}

// Index of the polyline segment containing arc length s (already in range).
function segmentAt(g: PathGeometry, s: number): number {
  let lo = 0,
    hi = g.cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (g.cum[mid] <= s) lo = mid;
    else hi = mid;
  }
  return lo;
}

// Point and tangent angle at arc length s. Closed paths wrap around; open
// paths extend along their end tangents so text can run past an end.
export function pointAt(g: PathGeometry, s: number): { x: number; y: number; angle: number } {
  const n = g.xs.length;
  if (n === 0) return { x: 0, y: 0, angle: 0 };
  if (n === 1 || g.length <= 0) return { x: g.xs[0], y: g.ys[0], angle: 0 };
  if (g.closed) s = ((s % g.length) + g.length) % g.length;
  let i: number;
  if (s <= 0) i = 0;
  else if (s >= g.length) i = n - 2;
  else i = segmentAt(g, s);
  // Skip zero-length segments for a stable direction.
  let j = i;
  while (j < n - 2 && g.cum[j + 1] - g.cum[j] < 1e-9) j++;
  while (j > 0 && g.cum[j + 1] - g.cum[j] < 1e-9) j--;
  const dx = g.xs[j + 1] - g.xs[j],
    dy = g.ys[j + 1] - g.ys[j];
  const len = Math.hypot(dx, dy) || 1;
  const t = (s - g.cum[j]) / len;
  return { x: g.xs[j] + dx * t, y: g.ys[j] + dy * t, angle: Math.atan2(dy, dx) };
}

// Point offset `v` along the normal (positive v is the descent side, to the
// right of the travel direction in y-down coordinates).
export function offsetPoint(g: PathGeometry, s: number, v: number): [number, number] {
  const p = pointAt(g, s);
  return [p.x - Math.sin(p.angle) * v, p.y + Math.cos(p.angle) * v];
}

// Nearest point on the path: its arc length and the signed normal distance.
export function nearestOnPath(g: PathGeometry, x: number, y: number): { s: number; distance: number } {
  const n = g.xs.length;
  if (n < 2) return { s: 0, distance: n ? Math.hypot(x - g.xs[0], y - g.ys[0]) : 0 };
  let best = Infinity,
    bs = 0,
    bd = 0;
  for (let i = 0; i < n - 1; i++) {
    const ax = g.xs[i], ay = g.ys[i], dx = g.xs[i + 1] - ax, dy = g.ys[i + 1] - ay;
    const l2 = dx * dx + dy * dy;
    if (l2 < 1e-18) continue;
    let t = ((x - ax) * dx + (y - ay) * dy) / l2;
    // Open ends extend along their tangents (hit testing past the ends).
    if (g.closed || (i > 0 && t < 0)) t = Math.max(0, t);
    if (g.closed || (i < n - 2 && t > 1)) t = Math.min(1, t);
    const px = ax + dx * t, py = ay + dy * t;
    const d = Math.hypot(x - px, y - py);
    if (d < best - 1e-9) {
      best = d;
      const l = Math.sqrt(l2);
      bs = g.cum[i] + t * l;
      // Normal (-dy, dx) / l points to the right of travel in y-down space.
      bd = ((x - px) * -dy + (y - py) * dx) / l;
    }
  }
  return { s: bs, distance: bd };
}

// Arc length range [a, a + span] of the text along the travel direction
// (the reversed path when flipped).
export function textRange(path: TypePath, length: number): { a: number; span: number } {
  let start = clamp01(path.start),
    end = clamp01(path.end);
  if (path.flip) [start, end] = [1 - end, 1 - start];
  if (!path.closed && end < start) [start, end] = [end, start];
  let span = (end - start) * length;
  if (path.closed && span <= 1e-9) span += length;
  return { a: start * length, span };
}
const clamp01 = (v: number) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0);

// Geometry in the travel direction.
export function travelGeometry(path: TypePath): PathGeometry {
  return pathGeometry(path.flip ? reverseKnots(path.knots, path.closed) : path.knots, path.closed);
}

// ------------------------------------------------------------ area text

// Horizontal spans [x0, x1] inside a closed outline over the band y0..y1
// (even-odd rule), each shrunk by `inset`. A span is kept only where every
// sampled scanline of the (inset-widened) band is inside the shape.
export function shapeSpans(g: PathGeometry, y0: number, y1: number, inset = 0): [number, number][] {
  const samples = 5;
  let acc: [number, number][] | undefined;
  const lo = y0 - inset,
    hi = y1 + inset;
  for (let k = 0; k < samples; k++) {
    const y = lo + ((hi - lo) * k) / (samples - 1);
    const xs: number[] = [];
    const n = g.xs.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      if (!g.closed && j === 0) break;
      const ay = g.ys[i], by = g.ys[j];
      if (ay === by) continue;
      // Half-open rule so vertices are not counted twice.
      if ((y >= ay && y < by) || (y >= by && y < ay)) xs.push(g.xs[i] + ((y - ay) / (by - ay)) * (g.xs[j] - g.xs[i]));
    }
    xs.sort((a, b) => a - b);
    const spans: [number, number][] = [];
    for (let i = 0; i + 1 < xs.length; i += 2) spans.push([xs[i], xs[i + 1]]);
    acc = acc ? intersectSpans(acc, spans) : spans;
    if (!acc.length) return [];
  }
  return (acc ?? []).map(([a, b]) => [a + inset, b - inset] as [number, number]).filter(([a, b]) => b > a);
}
function intersectSpans(a: [number, number][], b: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (const [a0, a1] of a)
    for (const [b0, b1] of b) {
      const x0 = Math.max(a0, b0),
        x1 = Math.min(a1, b1);
      if (x1 > x0) out.push([x0, x1]);
    }
  return out;
}

// ------------------------------------------------------------ path text

export type PathPlacement = {
  geometry: PathGeometry; // travel direction
  a: number; // arc length of the text start
  span: number; // available length
};

// Lays out path text: `flow` is the straight layout (layoutText without the
// path), called with the span so alignment works between the markers.
export function layoutOnPath(
  data: TextLayerData,
  opts: LayoutOptions,
  flow: (d: TextLayerData, o: LayoutOptions & { span?: number }) => TextLayout,
): TextLayout {
  const path = data.path!;
  const g = travelGeometry(path);
  const { a, span } = textRange(path, g.length);
  const straight = flow({ ...data, path: undefined, mode: 'point', box: undefined, origin: { x: 0, y: 0 }, orientation: 'horizontal', warp: undefined }, { ...opts, span });
  const map = (x: number, y: number) => offsetPoint(g, a + x, y);
  const unmap = (x: number, y: number): [number, number] => {
    const n = nearestOnPath(g, x, y);
    let s = n.s - a;
    if (g.closed && g.length > 0) {
      // Pick the wrap of s nearest the text range.
      while (s < -g.length / 2) s += g.length;
      while (s > span + g.length / 2) s -= g.length;
    }
    return [s, n.distance];
  };

  // Rigid glyphs: one run per cluster, rotated to the path.
  const runs: GlyphRun[] = [];
  let overflow = false;
  let visibleEnd = straight.length;
  const tol = 0.5;
  for (const run of straight.runs) {
    const n = run.clusters.length;
    // Visual left edge of each cluster (right-to-left runs go from the right).
    let x = run.rtl ? run.x + run.width : run.x;
    for (let k = 0; k < n; k++) {
      const adv = run.advances[k];
      const x0 = run.rtl ? x - adv : x;
      if (run.rtl) x -= adv;
      else x += adv;
      const text = run.clusters[k];
      if (!text.trim()) continue;
      // Tracking is part of the advance; the glyph itself is narrower.
      const ink = Math.max(1e-6, adv - run.letterSpacing * run.scaleX);
      if (x0 < -tol || x0 + ink > span + tol) {
        overflow = true;
        visibleEnd = Math.min(visibleEnd, clusterStart(run, k));
        continue;
      }
      const cx = x0 + ink / 2;
      const p0 = offsetPoint(g, a + cx - ink / 2, run.y),
        p1 = offsetPoint(g, a + cx + ink / 2, run.y);
      const c = offsetPoint(g, a + cx, run.y);
      const angle = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) > 1e-9 ? Math.atan2(p1[1] - p0[1], p1[0] - p0[0]) : pointAt(g, a + cx).angle;
      const cos = Math.cos(angle),
        sin = Math.sin(angle);
      runs.push({
        ...run,
        x: c[0] - (cos * ink) / 2,
        y: c[1] - (sin * ink) / 2,
        text: joinForShaping(run, k),
        clusters: [joinForShaping(run, k)],
        advances: [adv],
        width: adv,
        letterSpacing: 0,
        angle,
        start: run.start,
        end: run.end,
      });
    }
  }
  // Decorations follow the path as polylines.
  const decorations: Decoration[] = straight.decorations.map((d) => {
    const steps = Math.max(2, Math.ceil(d.width / 3));
    const points: [number, number][] = [];
    for (let i = 0; i <= steps; i++) points.push(map(d.x + (d.width * i) / steps, d.y));
    return { ...d, points };
  });
  const bounds = placedBounds(runs, decorations) ?? caretBox(map, straight);
  return {
    ...straight,
    runs,
    decorations,
    bounds,
    overflow: overflow || straight.overflow,
    visibleEnd,
    map,
    unmap,
    path: { geometry: g, a, span },
  };
}

// Source index of a cluster within a run (clusters may span several code units).
function clusterStart(run: GlyphRun, k: number): number {
  let i = run.start;
  for (let j = 0; j < k; j++) i += run.clusters[j].length;
  return Math.min(i, run.end);
}

// Cursive scripts lose their joining forms when letters are drawn one by
// one; zero-width joiners on the joined sides keep them.
const JOINING = /[ؠ-يٮ-ۓۺ-ۿݐ-ݿࢠ-ࣿ]/;
function joinForShaping(run: GlyphRun, k: number): string {
  const c = run.clusters[k];
  if (!run.rtl || !JOINING.test(c)) return c;
  const before = k > 0 && JOINING.test(run.clusters[k - 1]);
  const after = k + 1 < run.clusters.length && JOINING.test(run.clusters[k + 1]);
  return (before ? '‍' : '') + c + (after ? '‍' : '');
}

function placedBounds(runs: GlyphRun[], decorations: Decoration[]): Rect | undefined {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x: number, y: number) => {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  };
  for (const r of runs) {
    const c = Math.cos(r.angle ?? 0),
      s = Math.sin(r.angle ?? 0);
    for (const [u, v] of [[0, -r.ascent], [r.width, -r.ascent], [r.width, r.descent], [0, r.descent]] as const) add(r.x + u * c - v * s, r.y + u * s + v * c);
  }
  for (const d of decorations) for (const [x, y] of d.points ?? []) add(x, y);
  return x0 === Infinity ? undefined : { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}
function caretBox(map: (x: number, y: number) => [number, number], l: TextLayout): Rect {
  const c = l.caretRect(0);
  const p = map(c.x, c.y), q = map(c.x, c.y + c.height);
  const x = Math.min(p[0], q[0]), y = Math.min(p[1], q[1]);
  return { x, y, width: Math.max(1, Math.abs(q[0] - p[0])), height: Math.max(1, Math.abs(q[1] - p[1])) };
}

// ------------------------------------------------------------ arc presets

// Paths for Convert to Arc Text, sized for text of `width` pixels whose
// baseline is centered at (cx, cy). `bend` is -100..100 (negative curves the
// other way). Each returns knots and whether the path is closed.
export function arcPresetPath(preset: 'arch' | 'circle' | 'bow' | 'wave', width: number, cx: number, cy: number, bend = 50): { knots: number[][]; closed: boolean } {
  const w = Math.max(8, width);
  const b = Math.max(-100, Math.min(100, bend)) / 100;
  const K = 0.5522847498307936;
  if (preset === 'circle') {
    // A circle whose top carries the text: circumference ~ text width / span.
    const r = Math.max(4, w / (2 * Math.PI * Math.max(0.15, Math.abs(b) || 0.5)));
    const ccy = cy + r;
    const k = K * r;
    // Starts at the bottom, clockwise on screen (y down), so the top runs left to right.
    const pts = [
      [cx, ccy + r, cx + k, ccy + r, cx - k, ccy + r],
      [cx - r, ccy, cx - r, ccy + k, cx - r, ccy - k],
      [cx, ccy - r, cx - k, ccy - r, cx + k, ccy - r],
      [cx + r, ccy, cx + r, ccy - k, cx + r, ccy + k],
    ].map(([x, y, ix, iy, ox, oy]) => [ix, iy, x, y, ox, oy]);
    return { knots: pts, closed: true };
  }
  if (preset === 'wave') {
    // Two half waves (an S curve) through the center; a cubic whose controls
    // sit at height h peaks at 3h/4.
    const amp = w * 0.12 * (b || 0.5);
    const h = (4 * amp) / 3;
    const x0 = cx - w / 2, x1 = cx + w / 2, t = w / 6;
    return {
      knots: [
        [x0, cy, x0, cy, x0 + t, cy - h],
        [cx - t, cy - h, cx, cy, cx + t, cy + h],
        [x1 - t, cy + h, x1, cy, x1, cy],
      ],
      closed: false,
    };
  }
  // Arch (upward) and bow (sagging) are circular arcs through the ends.
  const sign = preset === 'bow' ? -1 : 1;
  const theta = Math.max(0.05, Math.abs(b) * Math.PI) * (b < 0 ? -1 : 1) * sign; // subtended angle, + bulges up
  const R = w / Math.abs(theta);
  // Arc length equals the text width so the text fills it.
  const half = Math.abs(theta) / 2;
  const up = theta > 0;
  const ccx = cx, ccy = up ? cy + R : cy - R;
  const segs = Math.max(1, Math.ceil(Math.abs(theta) / (Math.PI / 2)));
  const step = (2 * half) / segs;
  const k = (4 / 3) * Math.tan(step / 4) * R;
  const knots: number[][] = [];
  for (let i = 0; i <= segs; i++) {
    // Angle measured from the vertical through the center, left to right.
    const phi = -half + i * step;
    const x = ccx + R * Math.sin(phi);
    const y = up ? ccy - R * Math.cos(phi) : ccy + R * Math.cos(phi);
    // Unit tangent in the travel direction (left to right).
    const tx = Math.cos(phi), ty = up ? Math.sin(phi) : -Math.sin(phi);
    knots.push([i ? x - tx * k : x, i ? y - ty * k : y, x, y, i < segs ? x + tx * k : x, i < segs ? y + ty * k : y]);
  }
  return { knots, closed: false };
}
