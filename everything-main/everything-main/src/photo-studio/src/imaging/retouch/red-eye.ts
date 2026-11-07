// Red Eye removal: find the most pupil-like red blob near the click (or inside a
// dragged rectangle) and neutralize and darken it, leaving catchlights and the
// iris alone because their redness weight is zero.
import { cloneRGBA8, type IRect, type RGBA8 } from '../types';

export type RedEyeRegion = IRect | { x: number; y: number };
export type Pupil = { cx: number; cy: number; r: number };

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
// How red-dominant a pixel is, in [0, 1].
function redness(r: number, g: number, b: number) {
  const excess = r - Math.max(g, b);
  if (r < 50 || excess <= 0) return 0;
  return smoothstep(15, 60, excess) * smoothstep(0.4, 0.55, r / (r + g + b + 1));
}

function searchRect(img: RGBA8, where: RedEyeRegion): IRect {
  const { width: W, height: H } = img;
  let x0: number, y0: number, x1: number, y1: number;
  if ('width' in where) {
    x0 = where.x; y0 = where.y; x1 = where.x + where.width; y1 = where.y + where.height;
  } else {
    const half = Math.max(12, Math.round(Math.min(W, H) * 0.05));
    x0 = where.x - half; y0 = where.y - half; x1 = where.x + half; y1 = where.y + half;
  }
  x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0));
  x1 = Math.min(W, Math.ceil(x1)); y1 = Math.min(H, Math.ceil(y1));
  return { x: x0, y: y0, width: Math.max(0, x1 - x0), height: Math.max(0, y1 - y0) };
}

export function detectRedEye(img: RGBA8, where: RedEyeRegion): Pupil | null {
  const R = searchRect(img, where), { width: w, height: h } = R, d = img.data, W = img.width;
  if (!w || !h) return null;
  const red = new Float32Array(w * h), cand = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const o = ((y + R.y) * W + x + R.x) * 4, v = redness(d[o], d[o + 1], d[o + 2]) * (d[o + 3] / 255);
      red[y * w + x] = v;
      cand[y * w + x] = v > 0.35 ? 1 : 0;
    }
  const cx0 = 'width' in where ? R.x + w / 2 : where.x, cy0 = 'width' in where ? R.y + h / 2 : where.y;
  const lab = new Int32Array(w * h), stack: number[] = [];
  let best: Pupil | null = null, bestScore = 0, id = 0;
  for (let s = 0; s < w * h; s++) {
    if (!cand[s] || lab[s]) continue;
    id++;
    let area = 0, sx = 0, sy = 0, sr = 0, bx0 = w, by0 = h, bx1 = -1, by1 = -1;
    lab[s] = id;
    stack.push(s);
    while (stack.length) {
      const i = stack.pop()!, x = i % w, y = (i - x) / w;
      area++;
      sx += x;
      sy += y;
      sr += red[i];
      if (x < bx0) bx0 = x;
      if (x > bx1) bx1 = x;
      if (y < by0) by0 = y;
      if (y > by1) by1 = y;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const j = yy * w + xx;
          if (cand[j] && !lab[j]) {
            lab[j] = id;
            stack.push(j);
          }
        }
    }
    if (area < 4) continue;
    const bw = bx1 - bx0 + 1, bh = by1 - by0 + 1;
    // Round blobs fill ~pi/4 of their box and have an aspect near one; a
    // catchlight hole lowers the fill a little, which is tolerated.
    const fill = area / (bw * bh), aspect = Math.min(bw, bh) / Math.max(bw, bh);
    const round = smoothstep(0.35, 0.7, fill) * smoothstep(0.4, 0.8, aspect);
    const cx = R.x + sx / area + 0.5, cy = R.y + sy / area + 0.5;
    const near = 1 / (1 + Math.hypot(cx - cx0, cy - cy0) / Math.max(8, Math.max(bw, bh)));
    const score = sr * round * near;
    if (score > bestScore) {
      bestScore = score;
      best = { cx: R.x + bx0 + bw / 2, cy: R.y + by0 + bh / 2, r: (bw + bh) / 4 };
    }
  }
  return best;
}

// pupilSize and darkenAmount are percentages (0-100, default 50 each).
export function redEye(img: RGBA8, where: RedEyeRegion, pupilSize = 50, darkenAmount = 50): RGBA8 {
  const out = cloneRGBA8(img), p = detectRedEye(img, where);
  if (!p) return out;
  const { width: W, height: H } = img, d = out.data;
  const re = p.r * (0.6 + (0.8 * pupilSize) / 100), outer = re * 1.3 + 1, dark = (0.85 * darkenAmount) / 100;
  for (let y = Math.max(0, Math.floor(p.cy - outer)); y < Math.min(H, Math.ceil(p.cy + outer)); y++)
    for (let x = Math.max(0, Math.floor(p.cx - outer)); x < Math.min(W, Math.ceil(p.cx + outer)); x++) {
      const dist = Math.hypot(x + 0.5 - p.cx, y + 0.5 - p.cy);
      if (dist >= outer) continue;
      const o = (y * W + x) * 4, r = d[o], g = d[o + 1], b = d[o + 2];
      const wgt = (1 - smoothstep(re, outer, dist)) * smoothstep(0, 0.5, redness(r, g, b));
      if (wgt <= 0) continue;
      const gray = (g + b) / 2, k = 1 - wgt * dark;
      d[o] = (r + (gray - r) * wgt) * k;
      d[o + 1] = g * k;
      d[o + 2] = b * k;
    }
  return out;
}
