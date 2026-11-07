// Healing Brush, Patch tool and Spot Healing Brush. Healing is seamless cloning:
// keep the source patch's detail but solve for a smooth correction that makes it
// agree with the destination along the selection boundary (Pérez et al. 2003).
import { cloneRGBA8, type IRect, type Mask8, type RGBA8 } from '../types';
import { gaussianBlurF32, rng } from '../segment/filters';
import { boundingBox } from '../segment/mask-ops';
import { contextFillSmall } from './context-fill';
import { IGNORE, KNOWN, UNKNOWN, solveMembrane } from './poisson';

export type Offset = { x: number; y: number };

// Copy of a rectangle of an image (clipped rectangles must lie inside).
export function cropRGBA(img: RGBA8, r: IRect): RGBA8 {
  const out = new Uint8ClampedArray(r.width * r.height * 4);
  for (let y = 0; y < r.height; y++) out.set(img.data.subarray(((y + r.y) * img.width + r.x) * 4, ((y + r.y) * img.width + r.x + r.width) * 4), y * r.width * 4);
  return { width: r.width, height: r.height, data: out };
}
export function cropMask(m: Mask8, r: IRect): Mask8 {
  const out = new Uint8Array(r.width * r.height);
  for (let y = 0; y < r.height; y++) out.set(m.data.subarray((y + r.y) * m.width + r.x, (y + r.y) * m.width + r.x + r.width), y * r.width);
  return { width: r.width, height: r.height, data: out };
}

// Places `src` (with coverage `mask`, same size) at `offset` in `dst`, matching
// the destination along the mask boundary. For the best boundary match give the
// patch a one-pixel margin outside the mask; edges outside the patch are free.
export function heal(dst: RGBA8, src: RGBA8, mask: Mask8, offset: Offset, opts: { inPlace?: boolean } = {}): RGBA8 {
  const out = opts.inPlace ? dst : cloneRGBA8(dst);
  const { width: pw, height: ph } = src, W = dst.width, H = dst.height;
  if (mask.width !== pw || mask.height !== ph) throw new Error('Patch and mask sizes differ.');
  const ox = Math.round(offset.x), oy = Math.round(offset.y);
  // Unknowns: covered patch pixels that land inside the destination.
  let x0 = pw, y0 = ph, x1 = -1, y1 = -1;
  for (let v = 0; v < ph; v++)
    for (let u = 0; u < pw; u++) {
      const X = u + ox, Y = v + oy;
      if (mask.data[v * pw + u] && X >= 0 && Y >= 0 && X < W && Y < H) {
        if (u < x0) x0 = u;
        if (u > x1) x1 = u;
        if (v < y0) y0 = v;
        y1 = v;
      }
    }
  if (x1 < 0) return out;
  x0 = Math.max(0, x0 - 1); y0 = Math.max(0, y0 - 1);
  x1 = Math.min(pw - 1, x1 + 1); y1 = Math.min(ph - 1, y1 + 1);
  const gw = x1 - x0 + 1, gh = y1 - y0 + 1, n = gw * gh;
  const type = new Uint8Array(n), val = new Float32Array(n * 4);
  const inside = (u: number, v: number) => u + ox >= 0 && v + oy >= 0 && u + ox < W && v + oy < H;
  for (let y = 0; y < gh; y++)
    for (let x = 0; x < gw; x++) {
      const u = x + x0, v = y + y0;
      if (inside(u, v) && mask.data[v * pw + u]) type[y * gw + x] = UNKNOWN;
    }
  for (let y = 0; y < gh; y++)
    for (let x = 0; x < gw; x++) {
      const t = y * gw + x;
      if (type[t] !== IGNORE) continue;
      const u = x + x0, v = y + y0;
      if (!inside(u, v)) continue;
      const nb = (x > 0 && type[t - 1] === UNKNOWN) || (x < gw - 1 && type[t + 1] === UNKNOWN) || (y > 0 && type[t - gw] === UNKNOWN) || (y < gh - 1 && type[t + gw] === UNKNOWN);
      if (!nb) continue;
      type[t] = KNOWN;
      const si = (v * pw + u) * 4, di = ((v + oy) * W + u + ox) * 4, sa = src.data[si + 3], da = dst.data[di + 3];
      for (let c = 0; c < 3; c++) val[t * 4 + c] = (dst.data[di + c] * da - src.data[si + c] * sa) / 255;
      val[t * 4 + 3] = da - sa;
    }
  solveMembrane(val, type, gw, gh, 4, 1);
  const rgb = new Float64Array(3);
  for (let y = 0; y < gh; y++)
    for (let x = 0; x < gw; x++) {
      const t = y * gw + x;
      if (type[t] !== UNKNOWN) continue;
      const u = x + x0, v = y + y0, si = (v * pw + u) * 4, di = ((v + oy) * W + u + ox) * 4, m = mask.data[v * pw + u] / 255;
      const sa = src.data[si + 3], da = dst.data[di + 3];
      const ha = Math.min(255, Math.max(0, sa + val[t * 4 + 3]));
      const a = da * (1 - m) + ha * m;
      for (let c = 0; c < 3; c++) {
        const hc = Math.min(ha, Math.max(0, (src.data[si + c] * sa) / 255 + val[t * 4 + c]));
        rgb[c] = ((dst.data[di + c] * da) / 255) * (1 - m) + hc * m;
      }
      if (a <= 0) {
        out.data[di] = out.data[di + 1] = out.data[di + 2] = out.data[di + 3] = 0;
        continue;
      }
      for (let c = 0; c < 3; c++) out.data[di + c] = Math.round((rgb[c] * 255) / a);
      out.data[di + 3] = Math.round(a);
    }
  return out;
}

export type SpotHealMode = 'context' | 'proximity' | 'texture';

type Candidate = { dx: number; dy: number; score: number };

// Nearby source offsets ranked by how well their surroundings match the ring of
// pixels around the spot (the boundary the heal will have to agree with).
function candidates(img: RGBA8, mask: Mask8, B: IRect, T: IRect, rand: () => number): Candidate[] {
  const { width: W, height: H } = img, d = img.data;
  const size = Math.max(B.width, B.height), reach = Math.ceil(3.2 * size + 3);
  // Hole pixels in any rectangle, via a summed-area table over the search area only.
  const ax = Math.max(0, T.x - reach), ay = Math.max(0, T.y - reach);
  const aw = Math.min(W, T.x + T.width + reach) - ax, ah = Math.min(H, T.y + T.height + reach) - ay;
  const SW = aw + 1, sat = new Int32Array(SW * (ah + 1));
  for (let y = 0; y < ah; y++) {
    let row = 0;
    for (let x = 0; x < aw; x++) {
      row += mask.data[(y + ay) * W + x + ax] ? 1 : 0;
      sat[(y + 1) * SW + x + 1] = sat[y * SW + x + 1] + row;
    }
  }
  const holes = (X: number, Y: number, w: number, h: number) => {
    const x = X - ax, y = Y - ay;
    return sat[(y + h) * SW + x + w] - sat[y * SW + x + w] - sat[(y + h) * SW + x] + sat[y * SW + x];
  };
  const ring: number[] = [];
  for (let y = T.y; y < T.y + T.height; y++) for (let x = T.x; x < T.x + T.width; x++) if (!mask.data[y * W + x]) ring.push(y * W + x);
  const out: Candidate[] = [], jitter = rand() * Math.PI / 8;
  for (const k of [1.1, 1.6, 2.3, 3.2]) {
    const dist = k * size + 2;
    for (let a = 0; a < 16; a++) {
      const ang = jitter + (a * Math.PI) / 8, dx = Math.round(Math.cos(ang) * dist), dy = Math.round(Math.sin(ang) * dist);
      const sx = T.x + dx, sy = T.y + dy;
      if (sx < ax || sy < ay || sx + T.width > ax + aw || sy + T.height > ay + ah) continue;
      if (holes(sx, sy, T.width, T.height)) continue;
      let s = 0;
      for (const p of ring) {
        const q = (p + dy * W + dx) * 4, o = p * 4;
        const e0 = d[o] - d[q], e1 = d[o + 1] - d[q + 1], e2 = d[o + 2] - d[q + 2], e3 = d[o + 3] - d[q + 3];
        s += e0 * e0 + e1 * e1 + e2 * e2 + e3 * e3;
      }
      // Slight preference for closer sources.
      out.push({ dx, dy, score: s / Math.max(1, ring.length) + dist * 0.5 });
    }
  }
  return out.sort((p, q) => p.score - q.score);
}

// Spot Healing Brush: `mask` is the dab coverage in image coordinates.
export function spotHeal(img: RGBA8, mask: Mask8, mode: SpotHealMode = 'context', seed = 1, opts: { inPlace?: boolean } = {}): RGBA8 {
  const { width: W, height: H } = img;
  const B = boundingBox(mask);
  if (!B) return opts.inPlace ? img : cloneRGBA8(img);
  if (mode === 'context') return contextFillSmall(img, mask, { seed, inPlace: opts.inPlace });
  const x0 = B.x, y0 = B.y, x1 = B.x + B.width - 1, y1 = B.y + B.height - 1;
  const rw = Math.max(2, Math.round(Math.max(B.width, B.height) / 4));
  const T = { x: Math.max(0, x0 - rw), y: Math.max(0, y0 - rw), width: 0, height: 0 };
  T.width = Math.min(W, x1 + rw + 1) - T.x;
  T.height = Math.min(H, y1 + rw + 1) - T.y;
  const cands = candidates(img, mask, B, T, rng(seed));
  if (!cands.length) return contextFillSmall(img, mask, { seed, inPlace: opts.inPlace });
  const mp = cropMask(mask, T);
  const patchAt = (c: Candidate) => cropRGBA(img, { x: T.x + c.dx, y: T.y + c.dy, width: T.width, height: T.height });
  let patch = patchAt(cands[0]);
  if (mode === 'texture') {
    // Low frequencies from the best match (the heal replaces them anyway) plus
    // the averaged detail of the best few, rescaled to keep its contrast, which
    // breaks up recognizable structure into texture.
    const k = Math.min(4, cands.length), n = T.width * T.height, sigma = Math.max(1, Math.max(B.width, B.height) / 8);
    const out = new Float32Array(n * 4), plane = new Float32Array(n);
    for (let i = 0; i < k; i++) {
      const p = patchAt(cands[i]);
      for (let c = 0; c < 4; c++) {
        for (let j = 0; j < n; j++) plane[j] = p.data[j * 4 + c];
        const blurred = gaussianBlurF32(Float32Array.from(plane), T.width, T.height, sigma);
        for (let j = 0; j < n; j++) out[j * 4 + c] += i === 0 ? blurred[j] + (plane[j] - blurred[j]) / Math.sqrt(k) : (plane[j] - blurred[j]) / Math.sqrt(k);
      }
    }
    patch = { width: T.width, height: T.height, data: Uint8ClampedArray.from(out) };
  }
  return heal(img, patch, mp, { x: T.x, y: T.y }, opts);
}
