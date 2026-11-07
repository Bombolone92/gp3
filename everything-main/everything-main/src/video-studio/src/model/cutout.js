/**
 * Automatic background removal on video and image clips:
 * clip.cutout = { feather, shrink, smooth }. A person matte is found on
 * each frame (media/segmenter.js) and the compositor keeps only the
 * person (engine/cutout.js).
 *  - feather 0..100: how soft the edge is
 *  - shrink -50..50: pull the edge in (positive) or let more through (negative)
 *  - smooth 0..100: how much the matte is steadied from frame to frame
 *  - strokes (optional): hand-painted fixes, [{ keep, size, pts: [[u, v]...] }]
 *    with u, v in 0..1 of the source frame (top left origin) and size the
 *    brush diameter as a fraction of the frame height. Keep strokes add to
 *    the person, the others remove; later strokes win where they overlap.
 */
export const CUTOUT_DEFAULT = Object.freeze({ feather: 25, shrink: 0, smooth: 40 });

const num = (v, lo, hi, d) => (Number.isFinite(+v) ? Math.min(hi, Math.max(lo, +v)) : d);

export const MAX_STROKES = 300;
const MAX_POINTS = 4000;

export function normalizeCutout(c) {
  const out = {
    feather: num(c.feather, 0, 100, CUTOUT_DEFAULT.feather),
    shrink: num(c.shrink, -50, 50, CUTOUT_DEFAULT.shrink),
    smooth: num(c.smooth, 0, 100, CUTOUT_DEFAULT.smooth),
  };
  const strokes = normalizeStrokes(c.strokes);
  if (strokes.length) out.strokes = strokes;
  return out;
}

export function normalizeStrokes(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const s of list.slice(-MAX_STROKES)) {
    if (!s || !Array.isArray(s.pts)) continue;
    const pts = [];
    for (const p of s.pts.slice(0, MAX_POINTS)) {
      if (!Array.isArray(p) || !Number.isFinite(+p[0]) || !Number.isFinite(+p[1])) continue;
      pts.push([Math.round(num(p[0], 0, 1, 0) * 1e4) / 1e4, Math.round(num(p[1], 0, 1, 0) * 1e4) / 1e4]);
    }
    if (pts.length) out.push({ keep: Boolean(s.keep), size: num(s.size, 0.005, 0.5, 0.05), pts });
  }
  return out;
}

/**
 * Paint strokes into a w x h override map (-1 remove .. 1 keep, 0 untouched)
 * laid over the source frame stretched to that size. aspect is the source
 * width / height, so round brushes stay round on the picture.
 */
export function strokeOverride(strokes, w, h, aspect = 1) {
  const ov = new Float32Array(w * h);
  for (const s of strokes || []) {
    const ry = Math.max(0.5, (s.size * h) / 2);
    const rx = Math.max(0.5, (s.size * w) / 2 / aspect);
    const sign = s.keep ? 1 : -1;
    const stamp = (cx, cy) => {
      const x0 = Math.max(0, Math.floor(cx - rx - 1));
      const x1 = Math.min(w - 1, Math.ceil(cx + rx + 1));
      const y0 = Math.max(0, Math.floor(cy - ry - 1));
      const y1 = Math.min(h - 1, Math.ceil(cy + ry + 1));
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const dx = (x + 0.5 - cx) / rx;
          const dy = (y + 0.5 - cy) / ry;
          const d = Math.sqrt(dx * dx + dy * dy);
          // One pixel of soft edge.
          const a = Math.min(1, Math.max(0, (1 - d) * Math.min(rx, ry) + 0.5));
          if (a <= 0) continue;
          const i = y * w + x;
          if (sign > 0 ? ov[i] < a : ov[i] > -a) ov[i] = ov[i] * (1 - a) + sign * a;
        }
      }
    };
    let prev = null;
    for (const [u, v] of s.pts) {
      const p = [u * w, v * h];
      if (prev) {
        // Stamps along the segment, close enough to look continuous.
        const len = Math.hypot(p[0] - prev[0], p[1] - prev[1]);
        const n = Math.ceil(len / Math.max(0.5, Math.min(rx, ry) * 0.35));
        for (let k = 1; k <= n; k++) stamp(prev[0] + ((p[0] - prev[0]) * k) / n, prev[1] + ((p[1] - prev[1]) * k) / n);
      } else stamp(p[0], p[1]);
      prev = p;
    }
  }
  return ov;
}

/** Apply a stroke override to matte values (0..255), in place. */
export function applyOverride(data, ov) {
  for (let i = 0; i < data.length; i++) {
    const o = ov[i];
    if (o > 0) data[i] += (255 - data[i]) * o;
    else if (o < 0) data[i] *= 1 + o;
  }
  return data;
}

/**
 * Matte edge window [lo, hi] for a cutout: confidence below lo is hidden,
 * above hi is kept, with a smooth ramp between. Shrinking raises the
 * threshold; feathering widens the ramp.
 */
export function matteWindow(cutout) {
  const c = cutout || CUTOUT_DEFAULT;
  const mid = 0.5 + c.shrink * 0.008;
  const half = 0.015 + (c.feather / 100) * 0.3;
  return [Math.max(0, mid - half), Math.min(1, mid + half)];
}

/**
 * Steady a new matte against the previous one (both 0..255): where they
 * differ only a little the old value is blended in, so edges stop
 * flickering, while large changes (real motion) come through at once.
 */
export function steadyMatte(next, prev, smooth) {
  if (!prev || prev.length !== next.length || smooth <= 0) return next;
  const k = Math.min(0.85, (smooth / 100) * 0.85);
  const reach = 24 + smooth * 0.9;
  for (let i = 0; i < next.length; i++) {
    const d = Math.abs(next[i] - prev[i]);
    if (d < reach) {
      const w = k * (1 - d / reach);
      next[i] = Math.round(next[i] * (1 - w) + prev[i] * w);
    }
  }
  return next;
}
