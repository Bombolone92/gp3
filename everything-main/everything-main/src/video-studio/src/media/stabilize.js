/**
 * Stabilization: estimate how the whole picture shifts from frame to frame
 * (the median motion of a grid of patches, matched by normalized cross
 * correlation), add it up into the camera path, smooth that path, and
 * return the per-frame correction that moves each frame onto the smooth
 * path. Positions are in pixels of the analysis frames.
 */
import { search, patch } from './tracker.js';

const median = (arr) => {
  const s = [...arr].sort((a, b) => a - b);
  return s.length ? s[s.length >> 1] : 0;
};

/** Global shift (dx, dy) from frame a to frame b, from a grid of patches. */
export function frameShift(a, b, w, h, { cols = 5, rows = 3, size = 16, radius = 10 } = {}) {
  const dxs = [];
  const dys = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const x = Math.round(((i + 0.5) / cols) * w - size / 2);
      const y = Math.round(((j + 0.5) / rows) * h - size / 2);
      const tpl = patch(a, w, h, x, y, size, size);
      // Flat patches (sky, walls) can't be matched reliably.
      let mean = 0;
      for (const v of tpl) mean += v;
      mean /= tpl.length;
      let varc = 0;
      for (const v of tpl) varc += (v - mean) ** 2;
      if (varc / tpl.length < 0.0008) continue;
      const m = search(b, w, h, tpl, size, size, x, y, radius);
      if (m.score < 0.6) continue;
      dxs.push(m.x - x);
      dys.push(m.y - y);
    }
  }
  if (dxs.length < 3) return { dx: 0, dy: 0, ok: false };
  return { dx: median(dxs), dy: median(dys), ok: true };
}

/** Running sum of shifts: where the camera points at each frame (frame 0 = 0). */
export function cameraPath(shifts) {
  const path = [{ x: 0, y: 0 }];
  for (const s of shifts) {
    const last = path[path.length - 1];
    path.push({ x: last.x + s.dx, y: last.y + s.dy });
  }
  return path;
}

/** Gaussian smoothing of a path with radius r (in frames), edges held. */
export function smoothCamera(path, r) {
  if (r < 1) return path.map((p) => ({ ...p }));
  const sigma = r / 2;
  const weights = [];
  for (let k = -r; k <= r; k++) weights.push(Math.exp(-(k * k) / (2 * sigma * sigma)));
  return path.map((_, i) => {
    let x = 0;
    let y = 0;
    let wsum = 0;
    for (let k = -r; k <= r; k++) {
      const j = Math.min(path.length - 1, Math.max(0, i + k));
      const wt = weights[k + r];
      x += path[j].x * wt;
      y += path[j].y * wt;
      wsum += wt;
    }
    return { x: x / wsum, y: y / wsum };
  });
}

/**
 * Corrections that move each frame from the shaky path to the smooth one,
 * and the zoom needed so the moved frame still covers the view.
 */
export function corrections(path, smooth, w, h) {
  const out = path.map((p, i) => ({ x: smooth[i].x - p.x, y: smooth[i].y - p.y }));
  let mx = 0;
  let my = 0;
  for (const c of out) {
    mx = Math.max(mx, Math.abs(c.x));
    my = Math.max(my, Math.abs(c.y));
  }
  const zoom = Math.max(1 + (2 * mx) / w, 1 + (2 * my) / h);
  return { offsets: out, zoom: Math.min(1.5, zoom) };
}
