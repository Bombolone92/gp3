// Text warp: a smooth forward mapping of the text's bounding box for each
// warp style, used two ways: (1) point mapping for outlines and handles, and
// (2) bitmap warping, where a fine mesh is mapped forward and every output
// triangle is filled by inverse (barycentric) mapping with bilinear sampling.
// The mesh approach handles every style, including folds, without needing an
// analytic inverse. Mappings are defined relative to the box, so they are
// invariant under translation and uniform scale (preview == full render).

import { checkCancelled, type Progress, type RGBA8 } from '../types';
import type { Warp } from './model';
import type { Rect } from './layout';

export const isIdentityWarp = (w?: Warp) => !w || w.style === 'none' || (w.bend === 0 && w.horizontal === 0 && w.vertical === 0);

// Maps (x, y) inside or around `rect` to its warped position.
export function warpPoint(warp: Warp | undefined, rect: Rect, x: number, y: number): [number, number] {
  if (!warp || isIdentityWarp(warp)) return [x, y];
  const cx = rect.x + rect.width / 2, cy = rect.y + rect.height / 2;
  let hw = Math.max(rect.width / 2, 1e-6), hh = Math.max(rect.height / 2, 1e-6);
  let X = x - cx, Y = y - cy;
  const swap = warp.axis === 'vertical';
  if (swap) { [X, Y] = [Y, X]; [hw, hh] = [hh, hw]; }
  let H = warp.horizontal / 100, V = warp.vertical / 100;
  if (swap) [H, V] = [V, H];
  [X, Y] = styleMap(warp.style, warp.bend / 100, X, Y, hw, hh);
  // Distortion tapers one side like a perspective view of the warped text.
  if (H) Y *= 1 + 0.5 * H * clamp1(X / hw);
  if (V) X *= 1 + 0.5 * V * clamp1(Y / hh);
  if (swap) [X, Y] = [Y, X];
  return [cx + X, cy + Y];
}
const clamp1 = (t: number) => (t < -1 ? -1 : t > 1 ? 1 : t);

// Arc geometry, exported so tests and handles can reason about it: for a bend
// b the center line of width w becomes a circular arc subtending b*pi with
// the same length, so radius R = w / (b*pi) and the ends drop by the sagitta
// R * (1 - cos(b*pi/2)).
export function arcGeometry(bend: number, width: number) {
  const theta = (bend / 100) * Math.PI;
  const radius = theta ? width / theta : Infinity;
  return { theta, radius, sagitta: theta ? radius * (1 - Math.cos(theta / 2)) : 0 };
}

function styleMap(style: Warp['style'], b: number, X: number, Y: number, hw: number, hh: number): [number, number] {
  if (!b) return [X, Y];
  const u = X / hw, v = Y / hh;
  const cu = Math.max(0, 1 - u * u); // 1 at the center column, 0 at the sides
  const top = (1 - v) / 2, bottom = (1 + v) / 2; // 1 at the top / bottom edge
  switch (style) {
    case 'arc': {
      const theta = b * Math.PI;
      const R = (2 * hw) / theta;
      const phi = (u * theta) / 2;
      const r = R - Y;
      return [r * Math.sin(phi), R - r * Math.cos(phi)];
    }
    // Edge bends move by up to the full box height at 100% bend.
    case 'arc-lower': return [X, Y + 2 * b * hh * bottom * cu];
    case 'arc-upper': return [X, Y - 2 * b * hh * top * cu];
    case 'arch': return [X, Y - 2 * b * hh * cu * (0.6 + 0.4 * top)];
    case 'bulge': return [X, Y + b * hh * v * cu];
    case 'shell-lower': return [X * (1 + 0.5 * b * bottom), Y + 2 * b * hh * bottom * cu];
    case 'shell-upper': return [X * (1 + 0.5 * b * top), Y - 2 * b * hh * top * cu];
    case 'flag': return [X, Y - b * hh * Math.sin(Math.PI * u)];
    case 'wave': return [X, Y - 0.8 * b * hh * Math.sin(Math.PI * (1.5 * u + 0.25 * (v + 1)))];
    case 'fish': return [X, Y - 0.8 * b * hh * v * Math.sin(Math.PI * u) - 0.5 * b * hh * cu];
    case 'rise': return [X, Y - 2 * b * hh * Math.sin((Math.PI / 2) * u)];
    case 'fisheye': {
      const p2 = u * u + v * v;
      if (p2 >= 1) return [X, Y];
      const s = 1 + 0.5 * b * (1 - p2) * (1 - p2);
      return [X * s, Y * s];
    }
    case 'inflate': return [X * (1 + 0.6 * b * Math.max(0, 1 - v * v)), Y * (1 + 0.6 * b * cu)];
    case 'squeeze': return [X * (1 - 0.6 * b * Math.max(0, 1 - v * v)), Y * (1 + 0.6 * b * cu)];
    case 'twist': {
      const p = Math.min(1, Math.sqrt((u * u + v * v) / 2));
      const a = 0.5 * Math.PI * b * (1 - p) * (1 - p);
      const c = Math.cos(a), s = Math.sin(a);
      return [X * c - Y * s, X * s + Y * c];
    }
    default: return [X, Y];
  }
}

// Warps a bitmap. `rect` is the warp box in the bitmap's pixel coordinates;
// the result's (x, y) is where its pixel (0, 0) lands in those coordinates.
export function warpImage(src: RGBA8, warp: Warp | undefined, rect: Rect, progress?: Progress): { image: RGBA8; x: number; y: number } {
  const { width: sw, height: sh } = src;
  if (isIdentityWarp(warp) || sw === 0 || sh === 0) return { image: src, x: 0, y: 0 };
  // Mesh over the whole bitmap (ink can extend past the line boxes).
  const cell = 6;
  const nx = Math.min(256, Math.max(4, Math.ceil(sw / cell))), ny = Math.min(256, Math.max(4, Math.ceil(sh / cell)));
  const vx = new Float64Array((nx + 1) * (ny + 1)), vy = new Float64Array((nx + 1) * (ny + 1));
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let j = 0; j <= ny; j++)
    for (let i = 0; i <= nx; i++) {
      const [px, py] = warpPoint(warp, rect, (i / nx) * sw, (j / ny) * sh);
      const k = j * (nx + 1) + i;
      vx[k] = px; vy[k] = py;
      if (px < x0) x0 = px; if (px > x1) x1 = px;
      if (py < y0) y0 = py; if (py > y1) y1 = py;
    }
  const ox = Math.floor(x0) - 1, oy = Math.floor(y0) - 1;
  const ow = Math.min(16384, Math.ceil(x1) + 2 - ox), oh = Math.min(16384, Math.ceil(y1) + 2 - oy);
  const out = new Uint8ClampedArray(ow * oh * 4);
  const s = src.data;
  const tri = (ka: number, kb: number, kc: number, ua: number, va: number, ub: number, vb: number, uc: number, vc: number) => {
    const ax = vx[ka] - ox, ay = vy[ka] - oy, bx = vx[kb] - ox, by = vy[kb] - oy, cx = vx[kc] - ox, cy = vy[kc] - oy;
    let area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (Math.abs(area) < 1e-12) return;
    // Normalize to counter-clockwise so the edge tests share one sign.
    let Bx = bx, By = by, Cx = cx, Cy = cy, Ub = ub, Vb = vb, Uc = uc, Vc = vc;
    if (area < 0) { Bx = cx; By = cy; Cx = bx; Cy = by; Ub = uc; Vb = vc; Uc = ub; Vc = vb; area = -area; }
    const minX = Math.max(0, Math.floor(Math.min(ax, Bx, Cx))), maxX = Math.min(ow - 1, Math.ceil(Math.max(ax, Bx, Cx)));
    const minY = Math.max(0, Math.floor(Math.min(ay, By, Cy))), maxY = Math.min(oh - 1, Math.ceil(Math.max(ay, By, Cy)));
    // Inclusive edges: pixels on a shared edge are written twice with nearly
    // the same sample, which is harmless because writes replace, never blend.
    const eps = -1e-7 * area;
    const inv = 1 / area;
    for (let py = minY; py <= maxY; py++) {
      const yc = py + 0.5;
      for (let px = minX; px <= maxX; px++) {
        const xc = px + 0.5;
        const w0 = (Cx - Bx) * (yc - By) - (Cy - By) * (xc - Bx);
        const w1 = (ax - Cx) * (yc - Cy) - (ay - Cy) * (xc - Cx);
        const w2 = (Bx - ax) * (yc - ay) - (By - ay) * (xc - ax);
        if (w0 < eps || w1 < eps || w2 < eps) continue;
        const l0 = w0 * inv, l1 = w1 * inv, l2 = 1 - l0 - l1;
        const su = l0 * ua + l1 * Ub + l2 * Uc - 0.5, sv = l0 * va + l1 * Vb + l2 * Vc - 0.5;
        sampleBilinear(s, sw, sh, su, sv, out, (py * ow + px) * 4);
      }
    }
  };
  for (let j = 0; j < ny; j++) {
    checkCancelled(progress);
    progress?.report?.(j / ny);
    for (let i = 0; i < nx; i++) {
      const k00 = j * (nx + 1) + i, k10 = k00 + 1, k01 = k00 + nx + 1, k11 = k01 + 1;
      const u0 = (i / nx) * sw, u1 = ((i + 1) / nx) * sw, v0 = (j / ny) * sh, v1 = ((j + 1) / ny) * sh;
      tri(k00, k10, k11, u0, v0, u1, v0, u1, v1);
      tri(k00, k11, k01, u0, v0, u1, v1, u0, v1);
    }
  }
  progress?.report?.(1);
  return { image: { width: ow, height: oh, data: out }, x: ox, y: oy };
}

// Bilinear sample with straight alpha: colors are weighted by alpha so
// transparent texels do not bleed their (meaningless) color into edges.
function sampleBilinear(s: Uint8ClampedArray, w: number, h: number, x: number, y: number, out: Uint8ClampedArray, o: number) {
  const fx = Math.floor(x), fy = Math.floor(y);
  const tx = x - fx, ty = y - fy;
  let r = 0, g = 0, b = 0, a = 0;
  for (let k = 0; k < 4; k++) {
    const ix = fx + (k & 1), iy = fy + (k >> 1);
    if (ix < 0 || iy < 0 || ix >= w || iy >= h) continue;
    const wt = ((k & 1) ? tx : 1 - tx) * ((k >> 1) ? ty : 1 - ty);
    const i = (iy * w + ix) * 4;
    const wa = wt * s[i + 3];
    r += s[i] * wa; g += s[i + 1] * wa; b += s[i + 2] * wa; a += wa;
  }
  if (a <= 0) return;
  out[o] = r / a; out[o + 1] = g / a; out[o + 2] = b / a; out[o + 3] = a;
}
