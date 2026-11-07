/**
 * Arc-length sampling of a path: point and direction at a distance along
 * it, and the distance of the nearest point to a given point. Used to place
 * objects along a path (Objects on Path, blend spines).
 */
import { segmentCount, segmentPoints, pointAt, derivativeAt, nearestOnCubic, isLine } from './bezier.js';

const SAMPLES = 48;

/**
 * Sampler for an anchor list: { length, closed, at(s) -> { x, y, angle } ,
 * nearest(x, y) -> { s, d } }. `angle` is the tangent direction in radians
 * (screen space, y down). Distances clamp to [0, length] on open paths and
 * wrap on closed ones.
 */
export function pathSampler(anchors, closed) {
  const n = segmentCount(anchors, closed);
  const segs = [];
  let total = 0;
  for (let i = 0; i < n; i++) {
    const c = segmentPoints(anchors, i);
    if (isLine(c)) {
      // Straight segments map length to position exactly.
      const len = Math.hypot(c[6] - c[0], c[7] - c[1]);
      segs.push({ c, start: total, len, line: true });
      total += len;
      continue;
    }
    // Cumulative length table at SAMPLES + 1 parameter values.
    const ts = [0];
    const ls = [0];
    let prev = pointAt(c, 0);
    let len = 0;
    for (let k = 1; k <= SAMPLES; k++) {
      const t = k / SAMPLES;
      const p = pointAt(c, t);
      len += Math.hypot(p.x - prev.x, p.y - prev.y);
      ts.push(t);
      ls.push(len);
      prev = p;
    }
    segs.push({ c, start: total, len, ts, ls });
    total += len;
  }
  const locate = (s) => {
    if (!segs.length) return null;
    let lo = 0;
    let hi = segs.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (segs[mid].start <= s) lo = mid;
      else hi = mid - 1;
    }
    const seg = segs[lo];
    const local = Math.max(0, Math.min(seg.len, s - seg.start));
    if (seg.line) return { seg, u: seg.len ? local / seg.len : 0 };
    let k = 1;
    while (k < seg.ls.length - 1 && seg.ls[k] < local) k++;
    const l0 = seg.ls[k - 1];
    const l1 = seg.ls[k];
    const f = l1 > l0 ? (local - l0) / (l1 - l0) : 0;
    return { seg, t: seg.ts[k - 1] + (seg.ts[k] - seg.ts[k - 1]) * f };
  };
  const wrap = (s) => {
    if (!total) return 0;
    if (closed) return ((s % total) + total) % total;
    return Math.max(0, Math.min(total, s));
  };
  return {
    length: total,
    closed: Boolean(closed),
    at(s) {
      const loc = locate(wrap(s));
      if (!loc) {
        const a = anchors[0] || { x: 0, y: 0 };
        return { x: a.x, y: a.y, angle: 0 };
      }
      const c = loc.seg.c;
      if (loc.seg.line) return { x: c[0] + (c[6] - c[0]) * loc.u, y: c[1] + (c[7] - c[1]) * loc.u, angle: Math.atan2(c[7] - c[1], c[6] - c[0]) };
      const p = pointAt(loc.seg.c, loc.t);
      let d = derivativeAt(loc.seg.c, loc.t);
      if (Math.hypot(d.x, d.y) < 1e-9) {
        // Retracted handles: look a little further along the curve.
        const q = pointAt(loc.seg.c, Math.min(1, loc.t + 1e-3));
        const r = pointAt(loc.seg.c, Math.max(0, loc.t - 1e-3));
        d = { x: q.x - r.x, y: q.y - r.y };
      }
      return { x: p.x, y: p.y, angle: Math.atan2(d.y, d.x) };
    },
    nearest(x, y) {
      let best = { s: 0, d: Infinity };
      for (const seg of segs) {
        if (seg.line) {
          const c = seg.c;
          const dx = c[6] - c[0];
          const dy = c[7] - c[1];
          const u = seg.len ? Math.max(0, Math.min(1, ((x - c[0]) * dx + (y - c[1]) * dy) / (seg.len * seg.len))) : 0;
          const px = c[0] + dx * u;
          const py = c[1] + dy * u;
          const d = Math.hypot(x - px, y - py);
          if (d < best.d) best = { s: seg.start + u * seg.len, d, x: px, y: py };
          continue;
        }
        const r = nearestOnCubic(seg.c, x, y);
        if (r.d < best.d) {
          // Arc length at r.t from the table.
          let k = 1;
          while (k < seg.ts.length - 1 && seg.ts[k] < r.t) k++;
          const f = (r.t - seg.ts[k - 1]) / (seg.ts[k] - seg.ts[k - 1] || 1);
          best = { s: seg.start + seg.ls[k - 1] + (seg.ls[k] - seg.ls[k - 1]) * f, d: r.d, x: r.x, y: r.y };
        }
      }
      return best;
    },
  };
}
