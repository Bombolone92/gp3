// Piecewise-affine rendering of a deformed triangle mesh: every destination
// triangle is scan-converted into an inverse map (destination pixel ->
// source point) in drawing order, so where the mesh folds over itself the
// later triangle wins; the source is then sampled once per pixel.
import type { IRect, Progress, RGBA8 } from '../types';
import { checkCancelled, rgba8 } from '../types';
import { type Interp, samplerFor } from '../filters/sampling';

export type TriangleWarp = {
  // Source points per vertex (interleaved x, y, in source image pixels).
  src: ArrayLike<number>;
  // Destination points per vertex, in output pixels.
  dst: ArrayLike<number>;
  tris: ArrayLike<number>;
  // Triangle drawing order (defaults to mesh order).
  order?: ArrayLike<number>;
};

/** Integer bounds of the destination triangles. */
export function triangleBounds(dst: ArrayLike<number>, tris: ArrayLike<number>): IRect {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (let k = 0; k < tris.length; k++) {
    const v = tris[k];
    const x = dst[v * 2],
      y = dst[v * 2 + 1];
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  if (!(x1 >= x0)) return { x: 0, y: 0, width: 0, height: 0 };
  const x = Math.floor(x0),
    y = Math.floor(y0);
  return { x, y, width: Math.ceil(x1) - x, height: Math.ceil(y1) - y };
}

/** Render `warp` into the destination rectangle `out` (output pixels). */
export function renderTriangles(src: RGBA8, warp: TriangleWarp, out: IRect, method: Interp = 'bilinear', progress?: Progress): RGBA8 {
  const W = Math.max(0, out.width),
    H = Math.max(0, out.height);
  const image = rgba8(W, H);
  if (!W || !H) return image;
  const mapX = new Float32Array(W * H).fill(NaN),
    mapY = new Float32Array(W * H);
  const { src: S, dst: D, tris: T } = warp;
  const m = T.length / 3;
  for (let k = 0; k < m; k++) {
    if ((k & 1023) === 0) checkCancelled(progress);
    const t = warp.order ? warp.order[k] : k;
    const a = T[t * 3],
      b = T[t * 3 + 1],
      c = T[t * 3 + 2];
    const ax = D[a * 2] - out.x,
      ay = D[a * 2 + 1] - out.y,
      bx = D[b * 2] - out.x,
      by = D[b * 2 + 1] - out.y,
      cx = D[c * 2] - out.x,
      cy = D[c * 2 + 1] - out.y;
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (Math.abs(area) < 1e-12) continue;
    const inv = 1 / area;
    const sa = S[a * 2],
      ta = S[a * 2 + 1],
      sb = S[b * 2],
      tb = S[b * 2 + 1],
      sc = S[c * 2],
      tc = S[c * 2 + 1];
    const xs = Math.max(0, Math.floor(Math.min(ax, bx, cx) - 0.5)),
      xe = Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx) - 0.5)),
      ys = Math.max(0, Math.floor(Math.min(ay, by, cy) - 0.5)),
      ye = Math.min(H - 1, Math.ceil(Math.max(ay, by, cy) - 0.5));
    // Barycentric weights are affine in x, so step them along each row.
    const d0x = -(cy - by) * inv,
      d1x = -(ay - cy) * inv;
    for (let y = ys; y <= ye; y++) {
      const py = y + 0.5,
        px = xs + 0.5;
      let w0 = ((bx - px) * (cy - py) - (by - py) * (cx - px)) * inv,
        w1 = ((cx - px) * (ay - py) - (cy - py) * (ax - px)) * inv;
      let k2 = y * W + xs;
      for (let x = xs; x <= xe; x++, k2++, w0 += d0x, w1 += d1x) {
        const w2 = 1 - w0 - w1;
        if (w0 < -1e-7 || w1 < -1e-7 || w2 < -1e-7) continue;
        mapX[k2] = w0 * sa + w1 * sb + w2 * sc;
        mapY[k2] = w0 * ta + w1 * tb + w2 * tc;
      }
    }
  }
  const od = image.data,
    sampler = samplerFor(method),
    px = new Float32Array(4);
  for (let y = 0; y < H; y++) {
    if ((y & 63) === 0) {
      checkCancelled(progress);
      progress?.report?.(y / H);
    }
    for (let x = 0, k = y * W; x < W; x++, k++) {
      const mx = mapX[k];
      if (!(mx === mx)) continue;
      sampler(src, mx, mapY[k], 'transparent', px, 0);
      od[k * 4] = px[0];
      od[k * 4 + 1] = px[1];
      od[k * 4 + 2] = px[2];
      od[k * 4 + 3] = px[3];
    }
  }
  progress?.report?.(1);
  return image;
}
