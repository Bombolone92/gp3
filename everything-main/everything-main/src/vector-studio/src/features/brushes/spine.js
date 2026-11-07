/**
 * Spines: a subpath sampled by arc length, the frame every brush and
 * variable-width stroke is built along.
 *
 * buildSpine(anchors, closed) samples each segment densely (by curvature
 * and by a maximum step, so widths and artwork can vary smoothly along
 * straight segments too) and records, per sample, the arc length `s`, the
 * position and the unit tangent. Samples where two segments meet are
 * duplicated with the incoming and outgoing tangents, and anchors where the
 * direction jumps are listed as corners.
 *
 * Normals: with y pointing down the screen, the left side of a path (as you
 * walk along it) is n = (ty, -tx).
 */
import { segmentCount, segmentPoints, pointAt, derivativeAt, isLine } from '../../model/bezier.js';

const CORNER_COS = Math.cos((3 * Math.PI) / 180);

function unit(x, y) {
  const l = Math.hypot(x, y);
  return l > 1e-12 ? { x: x / l, y: y / l } : null;
}

/** Unit tangent of a cubic at t, robust to retracted handles at the ends. */
export function cubicTangent(c, t) {
  const d0 = derivativeAt(c, t);
  let d = unit(d0.x, d0.y);
  if (d) return d;
  // Retracted handle: step slightly inside the segment.
  const d1 = derivativeAt(c, t < 0.5 ? t + 1e-3 : t - 1e-3);
  d = unit(d1.x, d1.y);
  if (d) return d;
  return unit(c[6] - c[0], c[7] - c[1]) || { x: 1, y: 0 };
}

/**
 * Sample a subpath. Returns { segs: [[sample]], length, closed, corners }
 * where a sample is { x, y, s, tx, ty } and corners are
 * { s, x, y, tin, tout, turn } (turn > 0: the path turns right on screen).
 */
export function buildSpine(anchors, closed, { tolerance = 0.05, maxStep = 2 } = {}) {
  const segs = [];
  let s = 0;
  const n = segmentCount(anchors, closed);
  for (let i = 0; i < n; i++) {
    const c = segmentPoints(anchors, i);
    const pts = [];
    const chord = Math.hypot(c[6] - c[0], c[7] - c[1]);
    let count;
    if (isLine(c)) count = Math.max(1, Math.ceil(chord / maxStep));
    else {
      const ddx = Math.max(Math.abs(c[0] - 2 * c[2] + c[4]), Math.abs(c[2] - 2 * c[4] + c[6]));
      const ddy = Math.max(Math.abs(c[1] - 2 * c[3] + c[5]), Math.abs(c[3] - 2 * c[5] + c[7]));
      const wang = Math.ceil(Math.sqrt((3 * Math.hypot(ddx, ddy)) / (4 * tolerance)));
      const poly = Math.hypot(c[2] - c[0], c[3] - c[1]) + Math.hypot(c[4] - c[2], c[5] - c[3]) + Math.hypot(c[6] - c[4], c[7] - c[5]);
      count = Math.max(2, wang, Math.ceil(poly / maxStep));
    }
    count = Math.min(count, 2000);
    let px = c[0];
    let py = c[1];
    for (let k = 0; k <= count; k++) {
      const t = k / count;
      const p = k === 0 ? { x: c[0], y: c[1] } : k === count ? { x: c[6], y: c[7] } : pointAt(c, t);
      if (k) s += Math.hypot(p.x - px, p.y - py);
      const tan = cubicTangent(c, t);
      pts.push({ x: p.x, y: p.y, s, tx: tan.x, ty: tan.y });
      px = p.x;
      py = p.y;
    }
    // Zero-length segments carry no direction; they are dropped.
    if (pts[pts.length - 1].s - pts[0].s > 1e-9) segs.push(pts);
  }
  const corners = [];
  const m = segs.length;
  for (let i = closed ? 0 : 1; i < m; i++) {
    const a = segs[(i - 1 + m) % m];
    const b = segs[i];
    const tin = a[a.length - 1];
    const tout = b[0];
    const dot = tin.tx * tout.tx + tin.ty * tout.ty;
    if (dot < CORNER_COS) {
      corners.push({
        s: tout.s,
        x: tout.x,
        y: tout.y,
        index: i,
        tin: { x: tin.tx, y: tin.ty },
        tout: { x: tout.tx, y: tout.ty },
        turn: tin.tx * tout.ty - tin.ty * tout.tx,
      });
    }
  }
  return { segs, length: s, closed: Boolean(closed) && m > 0, corners };
}

/** All samples in order (segment joins appear twice, with both tangents). */
export function spineSamples(spine) {
  const out = [];
  for (const seg of spine.segs) for (const p of seg) out.push(p);
  return out;
}

/**
 * A sampler for positions along a spine: at(s) -> { x, y, tx, ty }.
 * Past the ends of an open spine it extends along the end tangents; on a
 * closed spine `s` wraps around.
 */
export function spineSampler(spine) {
  const pts = [];
  for (const seg of spine.segs) {
    for (let i = 0; i < seg.length; i++) {
      // Keep the duplicated join sample once (the outgoing one) for lookups.
      if (i === 0 && pts.length && Math.abs(pts[pts.length - 1].s - seg[0].s) < 1e-12) pts.pop();
      pts.push(seg[i]);
    }
  }
  const L = spine.length;
  const at = (s) => {
    if (!pts.length) return { x: 0, y: 0, tx: 1, ty: 0 };
    if (spine.closed && L > 0) s = ((s % L) + L) % L;
    if (s <= pts[0].s) {
      const p = pts[0];
      const d = s - p.s;
      return { x: p.x + p.tx * d, y: p.y + p.ty * d, tx: p.tx, ty: p.ty };
    }
    const last = pts[pts.length - 1];
    if (s >= last.s) {
      const d = s - last.s;
      return { x: last.x + last.tx * d, y: last.y + last.ty * d, tx: last.tx, ty: last.ty };
    }
    let lo = 0;
    let hi = pts.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (pts[mid].s <= s) lo = mid;
      else hi = mid;
    }
    const a = pts[lo];
    const b = pts[hi];
    const span = b.s - a.s;
    const f = span > 1e-12 ? (s - a.s) / span : 0;
    const t = unit(a.tx + (b.tx - a.tx) * f, a.ty + (b.ty - a.ty) * f) || { x: a.tx, y: a.ty };
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, tx: t.x, ty: t.y };
  };
  return { at, length: L, closed: spine.closed };
}

/** Nearest point on a spine to (x, y): { s, x, y, d }. */
export function nearestOnSpine(spine, x, y) {
  let best = null;
  for (const seg of spine.segs) {
    for (let i = 0; i < seg.length - 1; i++) {
      const a = seg[i];
      const b = seg[i + 1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const l2 = dx * dx + dy * dy;
      const f = l2 > 0 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / l2)) : 0;
      const px = a.x + dx * f;
      const py = a.y + dy * f;
      const d = Math.hypot(x - px, y - py);
      if (!best || d < best.d) best = { s: a.s + (b.s - a.s) * f, x: px, y: py, d };
    }
  }
  return best;
}
