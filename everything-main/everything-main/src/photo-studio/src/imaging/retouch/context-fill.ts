// Context Fill: fills a hole with texture and structure taken from elsewhere in
// the image. Multi-scale PatchMatch nearest-neighbor search (Barnes, Shechtman,
// Finkelstein and Goldman, SIGGRAPH 2009) inside the expectation-maximization
// completion of Wexler, Shechtman and Irani ("Space-Time Completion of Video",
// PAMI 2007): at each pyramid level, alternately find for every patch touching
// the hole its most similar valid source patch, then re-estimate each hole pixel
// as the similarity-weighted vote of all source patches that cover it.
//
// Colors are premultiplied by alpha throughout, so transparent regions behave.
import { checkCancelled, cloneRGBA8, type IRect, type Mask8, type Progress, type RGBA8 } from '../types';
import { rng } from '../segment/filters';
import { boundingBox, edtSquared } from '../segment/mask-ops';
import { KNOWN, UNKNOWN, solveMembrane } from './poisson';

export type ContextFillOptions = {
  // Allowed source region (coverage > 0). Default: everything outside the hole
  // within a generous margin around it.
  sampling?: Mask8;
  colorAdaptation?: 'none' | 'default' | 'high';
  rotationAdaptation?: 'none' | 'low' | 'medium' | 'high' | 'full';
  // Also sample from copies scaled by 0.8 and 1.25.
  scale?: boolean;
  // Also sample from a horizontally mirrored copy.
  mirror?: boolean;
  seed?: number;
  // Patch side in pixels (odd, 5-15). Default 7.
  patchSize?: number;
};

type Variant = { w: number; h: number; img: Uint8ClampedArray; ok: Uint8Array; list: Int32Array };
type Level = { w: number; h: number; img: Uint8ClampedArray; hole: Uint8Array; valid: Uint8Array; variants: Variant[] };
type Transform = { angle: number; scale: number; flip: boolean };
// Nearest-neighbor field over the target window of one level.
type Field = { x0: number; y0: number; tw: number; th: number; center: Uint8Array; s: Uint8Array; qx: Int32Array; qy: Int32Array; d: Float32Array };
type Schedule = { em: number; pm: number; radius: number };

function transforms(o: ContextFillOptions): Transform[] {
  const t: Transform[] = [{ angle: 0, scale: 1, flip: false }];
  if (o.mirror) t.push({ angle: 0, scale: 1, flip: true });
  if (o.scale) t.push({ angle: 0, scale: 0.8, flip: false }, { angle: 0, scale: 1.25, flip: false });
  const rot = { none: [], low: [-8, 8], medium: [-16, -8, 8, 16], high: [-30, -20, -10, 10, 20, 30], full: [-135, -90, -45, 45, 90, 135, 180] }[o.rotationAdaptation ?? 'none'];
  for (const a of rot) t.push({ angle: (a * Math.PI) / 180, scale: 1, flip: false });
  return t;
}

// Centers whose whole patch lies on valid pixels, via a summed-area table.
function validCenters(valid: Uint8Array, w: number, h: number, r: number) {
  const W = w + 1, sat = new Int32Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += valid[y * w + x] ? 0 : 1;
      sat[(y + 1) * W + x + 1] = sat[y * W + x + 1] + row;
    }
  }
  const ok = new Uint8Array(w * h);
  let count = 0;
  for (let y = r; y < h - r; y++)
    for (let x = r; x < w - r; x++) {
      const bad = sat[(y + r + 1) * W + x + r + 1] - sat[(y - r) * W + x + r + 1] - sat[(y + r + 1) * W + x - r] + sat[(y - r) * W + x - r];
      if (!bad) {
        ok[y * w + x] = 1;
        count++;
      }
    }
  const list = new Int32Array(count);
  for (let i = 0, k = 0; k < count; i++) if (ok[i]) list[k++] = i;
  return { ok, list };
}

function makeVariant(L: { w: number; h: number; img: Uint8ClampedArray; valid: Uint8Array }, t: Transform, r: number): Variant {
  if (!t.flip && t.angle === 0 && t.scale === 1) return { w: L.w, h: L.h, img: L.img, ...validCenters(L.valid, L.w, L.h, r) };
  const c = Math.cos(t.angle), s = Math.sin(t.angle);
  const w = Math.max(1, Math.ceil((Math.abs(c) * L.w + Math.abs(s) * L.h) * t.scale));
  const h = Math.max(1, Math.ceil((Math.abs(s) * L.w + Math.abs(c) * L.h) * t.scale));
  const img = new Uint8ClampedArray(w * h * 4), valid = new Uint8Array(w * h);
  const icx = L.w / 2, icy = L.h / 2, ocx = w / 2, ocy = h / 2;
  for (let v = 0; v < h; v++)
    for (let u = 0; u < w; u++) {
      // Inverse map: output -> input (undo scale, rotation, then mirror).
      let dx = (u + 0.5 - ocx) / t.scale, dy = (v + 0.5 - ocy) / t.scale;
      const rx = c * dx + s * dy, ry = -s * dx + c * dy;
      dx = t.flip ? -rx : rx;
      dy = ry;
      const fx = icx + dx - 0.5, fy = icy + dy - 0.5;
      if (fx < 0 || fy < 0 || fx > L.w - 1 || fy > L.h - 1) continue;
      const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(x0 + 1, L.w - 1), y1 = Math.min(y0 + 1, L.h - 1);
      const a = y0 * L.w + x0, b = y0 * L.w + x1, cc = y1 * L.w + x0, d = y1 * L.w + x1;
      if (!(L.valid[a] && L.valid[b] && L.valid[cc] && L.valid[d])) continue;
      const tx = fx - x0, ty = fy - y0, o = (v * w + u) * 4;
      for (let k = 0; k < 4; k++) {
        const top = L.img[a * 4 + k] + (L.img[b * 4 + k] - L.img[a * 4 + k]) * tx;
        const bot = L.img[cc * 4 + k] + (L.img[d * 4 + k] - L.img[cc * 4 + k]) * tx;
        img[o + k] = top + (bot - top) * ty;
      }
      valid[v * w + u] = 1;
    }
  return { w, h, img, ...validCenters(valid, w, h, r) };
}

function downLevel(L: { w: number; h: number; img: Uint8ClampedArray; hole: Uint8Array; valid: Uint8Array }) {
  const w = (L.w + 1) >> 1, h = (L.h + 1) >> 1;
  const img = new Uint8ClampedArray(w * h * 4), hole = new Uint8Array(w * h), valid = new Uint8Array(w * h);
  const acc = new Float64Array(4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let n = 0, ho = 0, va = 1;
      acc.fill(0);
      for (let dy = 0; dy < 2; dy++)
        for (let dx = 0; dx < 2; dx++) {
          const xx = 2 * x + dx, yy = 2 * y + dy;
          if (xx >= L.w || yy >= L.h) continue;
          const i = yy * L.w + xx;
          n++;
          ho |= L.hole[i];
          va &= L.valid[i];
          for (let k = 0; k < 4; k++) acc[k] += L.img[i * 4 + k];
        }
      const o = y * w + x;
      for (let k = 0; k < 4; k++) img[o * 4 + k] = acc[k] / n;
      hole[o] = ho;
      valid[o] = va;
    }
  return { w, h, img, hole, valid };
}

// SSD between a target patch (float) and a source patch (bytes), abandoning as
// soon as the running sum exceeds `best`.
function patchDist(T: Float32Array, tw: number, tx: number, ty: number, S: Uint8ClampedArray, sw: number, sx: number, sy: number, r: number, best: number) {
  const side = 2 * r + 1;
  let sum = 0;
  for (let dy = -r; dy <= r; dy++) {
    let ti = ((ty + dy) * tw + tx - r) * 4, si = ((sy + dy) * sw + sx - r) * 4;
    for (let k = 0; k < side; k++, ti += 4, si += 4) {
      const a = T[ti] - S[si], b = T[ti + 1] - S[si + 1], c = T[ti + 2] - S[si + 2], d = T[ti + 3] - S[si + 3];
      sum += a * a + b * b + c * c + d * d;
    }
    if (sum >= best) return sum;
  }
  return sum;
}

// Bias-invariant variant for high color adaptation: per-channel mean differences
// are removed (no early exit, since the correction can lower the sum).
function patchDistBias(T: Float32Array, tw: number, tx: number, ty: number, S: Uint8ClampedArray, sw: number, sx: number, sy: number, r: number) {
  let sum = 0, m0 = 0, m1 = 0, m2 = 0;
  const n = (2 * r + 1) * (2 * r + 1);
  for (let dy = -r; dy <= r; dy++) {
    let ti = ((ty + dy) * tw + tx - r) * 4, si = ((sy + dy) * sw + sx - r) * 4;
    for (let k = 0; k <= 2 * r; k++, ti += 4, si += 4) {
      const a = T[ti] - S[si], b = T[ti + 1] - S[si + 1], c = T[ti + 2] - S[si + 2], d = T[ti + 3] - S[si + 3];
      sum += a * a + b * b + c * c + d * d;
      m0 += a;
      m1 += b;
      m2 += c;
    }
  }
  // Clamp the allowed shift so wildly different patches are not "adapted" into matches.
  const lim = 48 * n, c0 = Math.max(-lim, Math.min(lim, m0)), c1 = Math.max(-lim, Math.min(lim, m1)), c2 = Math.max(-lim, Math.min(lim, m2));
  return sum - (c0 * c0 + c1 * c1 + c2 * c2) / n;
}

class LevelSynth {
  readonly f: Field;
  readonly tgt: Float32Array;
  readonly holeT: Uint8Array;
  readonly centers: Int32Array;
  // Per-center vote confidence: patches resting on known pixels near the hole
  // boundary are trusted more than ones deep inside (Wexler et al.'s
  // gamma^-distance weighting), which carries boundary structure inward.
  readonly conf: Float32Array;
  constructor(readonly L: Level, readonly r: number, readonly rand: () => number, readonly bias: boolean) {
    const { w, h, hole } = L;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        if (hole[y * w + x]) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          y1 = y;
        }
    const m = 2 * r;
    x0 = Math.max(0, x0 - m); y0 = Math.max(0, y0 - m);
    x1 = Math.min(w - 1, x1 + m); y1 = Math.min(h - 1, y1 + m);
    const tw = x1 - x0 + 1, th = y1 - y0 + 1, n = tw * th;
    this.tgt = new Float32Array(n * 4);
    this.holeT = new Uint8Array(n);
    for (let y = 0; y < th; y++)
      for (let x = 0; x < tw; x++) {
        const i = (y + y0) * w + x + x0, j = y * tw + x;
        for (let k = 0; k < 4; k++) this.tgt[j * 4 + k] = L.img[i * 4 + k];
        this.holeT[j] = hole[i];
      }
    // Patch centers that overlap the hole (Chebyshev dilation by r) and fit.
    const rowHas = new Uint8Array(n);
    for (let y = 0; y < th; y++) {
      let run = 0;
      for (let x = 0; x < tw + r; x++) {
        if (x < tw && this.holeT[y * tw + x]) run = 2 * r + 1;
        if (run > 0) {
          const xx = x - r;
          if (xx >= 0 && xx < tw) rowHas[y * tw + xx] = 1;
          run--;
        }
      }
    }
    const center = new Uint8Array(n), list: number[] = [];
    for (let x = 0; x < tw; x++) {
      let run = 0;
      for (let y = 0; y < th + r; y++) {
        if (y < th && rowHas[y * tw + x]) run = 2 * r + 1;
        if (run > 0) {
          const yy = y - r;
          const gx = x + x0, gy = yy + y0;
          if (yy >= 0 && yy < th && gx >= r && gy >= r && gx < w - r && gy < h - r) center[yy * tw + x] = 1;
          run--;
        }
      }
    }
    for (let i = 0; i < n; i++) if (center[i]) list.push(i);
    this.centers = Int32Array.from(list);
    this.f = { x0, y0, tw, th, center, s: new Uint8Array(n), qx: new Int32Array(n), qy: new Int32Array(n), d: new Float32Array(n) };
    const known = new Uint8Array(n);
    for (let i = 0; i < n; i++) known[i] = this.holeT[i] ? 0 : 1;
    const d2 = edtSquared(known, tw, th), W1 = tw + 1, sat = new Float64Array(W1 * (th + 1));
    for (let y = 0; y < th; y++) {
      let row = 0;
      for (let x = 0; x < tw; x++) {
        row += Math.pow(1.3, -Math.sqrt(d2[y * tw + x]));
        sat[(y + 1) * W1 + x + 1] = sat[y * W1 + x + 1] + row;
      }
    }
    this.conf = new Float32Array(n);
    for (const j of this.centers) {
      const x = j % tw, y = (j - x) / tw;
      const xa = Math.max(0, x - r), ya = Math.max(0, y - r), xb = Math.min(tw, x + r + 1), yb = Math.min(th, y + r + 1);
      this.conf[j] = (sat[yb * W1 + xb] - sat[ya * W1 + xb] - sat[yb * W1 + xa] + sat[ya * W1 + xa]) / ((xb - xa) * (yb - ya));
    }
  }

  private dist(j: number, s: number, qx: number, qy: number, best: number) {
    const f = this.f, V = this.L.variants[s], x = j % f.tw, y = (j - x) / f.tw;
    return this.bias ? patchDistBias(this.tgt, f.tw, x, y, V.img, V.w, qx, qy, this.r) : patchDist(this.tgt, f.tw, x, y, V.img, V.w, qx, qy, this.r, best);
  }

  randomize(j: number) {
    const vs = this.L.variants, s = vs.length > 1 && this.rand() < 0.3 ? Math.floor(this.rand() * vs.length) : 0;
    const V = vs[s], q = V.list[Math.floor(this.rand() * V.list.length)];
    this.f.s[j] = s;
    this.f.qx[j] = q % V.w;
    this.f.qy[j] = Math.floor(q / V.w);
  }

  initRandom() {
    for (const j of this.centers) this.randomize(j);
  }

  // Seed the field from the coarser level: same variant, doubled coordinates.
  initFrom(prev: LevelSynth) {
    const f = this.f, p = prev.f, vs = this.L.variants;
    for (const j of this.centers) {
      const x = (j % f.tw) + f.x0, y = Math.floor(j / f.tw) + f.y0;
      const cx = (x >> 1) - p.x0, cy = (y >> 1) - p.y0;
      if (cx < 0 || cy < 0 || cx >= p.tw || cy >= p.th || !p.center[cy * p.tw + cx]) {
        this.randomize(j);
        continue;
      }
      const pj = cy * p.tw + cx, s = p.s[pj], V = vs[s];
      const bx = 2 * p.qx[pj] + (x & 1), by = 2 * p.qy[pj] + (y & 1);
      let found = false;
      for (let rad = 0; rad <= 2 && !found; rad++)
        for (let dy = -rad; dy <= rad && !found; dy++)
          for (let dx = -rad; dx <= rad; dx++) {
            const qx = bx + dx, qy = by + dy;
            if (qx < 0 || qy < 0 || qx >= V.w || qy >= V.h || !V.ok[qy * V.w + qx]) continue;
            f.s[j] = s;
            f.qx[j] = qx;
            f.qy[j] = qy;
            found = true;
            break;
          }
      if (!found) this.randomize(j);
    }
  }

  // Coarsest level: smooth membrane fill of the hole as the starting estimate.
  diffuse() {
    const { tw, th } = this.f, type = new Uint8Array(tw * th);
    for (let i = 0; i < type.length; i++) type[i] = this.holeT[i] ? UNKNOWN : KNOWN;
    solveMembrane(this.tgt, type, tw, th, 4);
  }

  computeDistances() {
    const f = this.f;
    for (const j of this.centers) f.d[j] = this.dist(j, f.s[j], f.qx[j], f.qy[j], Infinity);
  }

  // One PatchMatch pass: propagation from already-visited neighbors, then a
  // random search with exponentially shrinking radius around the current best.
  // Keep candidate (s, qx, qy) for center j if it is valid and closer.
  private consider(j: number, s: number, qx: number, qy: number) {
    const V = this.L.variants[s], f = this.f;
    if (qx < 0 || qy < 0 || qx >= V.w || qy >= V.h || !V.ok[qy * V.w + qx]) return;
    if (s === f.s[j] && qx === f.qx[j] && qy === f.qy[j]) return;
    const d = this.dist(j, s, qx, qy, f.d[j]);
    if (d < f.d[j]) {
      f.d[j] = d;
      f.s[j] = s;
      f.qx[j] = qx;
      f.qy[j] = qy;
    }
  }

  pass(forward: boolean, maxRadius: number) {
    const f = this.f, vs = this.L.variants, C = this.centers, tw = f.tw, step = forward ? 1 : -1, rand = this.rand;
    for (let k = forward ? 0 : C.length - 1; forward ? k < C.length : k >= 0; k += step) {
      const j = C[k], x = j % tw, a = j - step, b = j - step * tw;
      if (x - step >= 0 && x - step < tw && f.center[a]) this.consider(j, f.s[a], f.qx[a] + step, f.qy[a]);
      if (b >= 0 && b < f.center.length && f.center[b]) this.consider(j, f.s[b], f.qx[b], f.qy[b] + step);
      for (let R = maxRadius; R >= 1; R >>= 1) {
        const V = vs[f.s[j]], rr = Math.min(R, Math.max(V.w, V.h));
        this.consider(j, f.s[j], f.qx[j] + Math.floor((rand() * 2 - 1) * rr + 0.5), f.qy[j] + Math.floor((rand() * 2 - 1) * rr + 0.5));
      }
      if (vs.length > 1) {
        const s = Math.floor(rand() * vs.length), V = vs[s];
        if (V.list.length) {
          const q = V.list[Math.floor(rand() * V.list.length)];
          this.consider(j, s, q % V.w, Math.floor(q / V.w));
        }
      }
    }
  }

  // Similarity-weighted voting. Returns the accumulators so the caller can read
  // votes on known pixels next to the hole (used for color adaptation).
  vote(weighted: boolean, includeKnown = false) {
    const f = this.f, { tw, th } = f, r = this.r, n = tw * th, vs = this.L.variants;
    const acc = new Float32Array(n * 4), wsum = new Float32Array(n);
    let sigma2 = 1;
    if (weighted && this.centers.length) {
      // 75th percentile of the patch distances (Wexler et al.), from a sample.
      const C = this.centers, m = Math.min(C.length, 1024), ds = new Float32Array(m);
      for (let k = 0; k < m; k++) ds[k] = f.d[C[Math.floor((k * C.length) / m)]];
      ds.sort();
      sigma2 = Math.max(1, ds[Math.floor(m * 0.75)]);
    }
    const side = 2 * r + 1, area = side * side, mt = [0, 0, 0, 0], ms = [0, 0, 0, 0];
    for (const j of this.centers) {
      const V = vs[f.s[j]], qx = f.qx[j], qy = f.qy[j], x = j % tw, y = (j - x) / tw;
      const wgt = (weighted ? Math.exp(-f.d[j] / (2 * sigma2)) + 1e-6 : 1) * this.conf[j];
      let b0 = 0, b1 = 0, b2 = 0;
      if (this.bias) {
        mt.fill(0);
        ms.fill(0);
        for (let dy = -r; dy <= r; dy++)
          for (let dx = -r; dx <= r; dx++) {
            const ti = ((y + dy) * tw + x + dx) * 4, si = ((qy + dy) * V.w + qx + dx) * 4;
            for (let c = 0; c < 3; c++) {
              mt[c] += this.tgt[ti + c];
              ms[c] += V.img[si + c];
            }
          }
        const lim = 48;
        b0 = Math.max(-lim, Math.min(lim, (mt[0] - ms[0]) / area));
        b1 = Math.max(-lim, Math.min(lim, (mt[1] - ms[1]) / area));
        b2 = Math.max(-lim, Math.min(lim, (mt[2] - ms[2]) / area));
      }
      for (let dy = -r; dy <= r; dy++) {
        const tRow = (y + dy) * tw + x, sRow = (qy + dy) * V.w + qx;
        for (let dx = -r; dx <= r; dx++) {
          const t = tRow + dx;
          if (!this.holeT[t] && !includeKnown) continue;
          const si = (sRow + dx) * 4, ti = t * 4;
          acc[ti] += wgt * (V.img[si] + b0);
          acc[ti + 1] += wgt * (V.img[si + 1] + b1);
          acc[ti + 2] += wgt * (V.img[si + 2] + b2);
          acc[ti + 3] += wgt * V.img[si + 3];
          wsum[t] += wgt;
        }
      }
    }
    for (let t = 0; t < n; t++) {
      if (!this.holeT[t] || !wsum[t]) continue;
      const inv = 1 / wsum[t];
      for (let c = 0; c < 4; c++) this.tgt[t * 4 + c] = Math.min(255, Math.max(0, acc[t * 4 + c] * inv));
    }
    return { acc, wsum };
  }
}

export type SynthResult = { rect: IRect; fill: Float32Array; hole: Uint8Array; ring?: Float32Array };

// Core synthesis on a cropped image: `hole` marks pixels to fill, `valid` the
// allowed source pixels. Returns premultiplied colors over the target window.
export function synthesize(img: RGBA8, hole: Uint8Array, valid: Uint8Array, opts: ContextFillOptions, progress?: Progress, fast = false): SynthResult | null {
  const r = Math.max(2, Math.min(7, ((opts.patchSize ?? 7) - 1) >> 1)), rand = rng(opts.seed ?? 1);
  const bias = opts.colorAdaptation === 'high';
  // Premultiplied level 0.
  const n = img.width * img.height, pm = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const a = img.data[i * 4 + 3];
    pm[i * 4] = (img.data[i * 4] * a) / 255;
    pm[i * 4 + 1] = (img.data[i * 4 + 1] * a) / 255;
    pm[i * 4 + 2] = (img.data[i * 4 + 2] * a) / 255;
    pm[i * 4 + 3] = a;
  }
  let holeW = 0, holeH = 0;
  {
    let x0 = img.width, y0 = img.height, x1 = -1, y1 = -1;
    for (let i = 0; i < n; i++)
      if (hole[i]) {
        const x = i % img.width, y = (i - x) / img.width;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    if (x1 < 0) return null;
    holeW = x1 - x0 + 1;
    holeH = y1 - y0 + 1;
  }
  const ts = transforms(opts);
  const raw = [{ w: img.width, h: img.height, img: pm, hole, valid }];
  // Coarsen until the hole is about two patches across, keeping enough sources.
  const target = 2 * (2 * r + 1);
  while (Math.max(holeW, holeH) / 2 ** (raw.length - 1) > target) {
    const next = downLevel(raw[raw.length - 1]);
    if (Math.min(next.w, next.h) < 4 * r + 4) break;
    raw.push(next);
  }
  const levels: Level[] = [];
  for (const L of raw) {
    const variants = ts.map((t) => makeVariant(L, t, r));
    levels.push({ ...L, variants: variants.filter((v, i) => i === 0 || v.list.length > 0) });
  }
  // Drop coarse levels that have no valid identity source at all.
  while (levels.length > 1 && levels[levels.length - 1].variants[0].list.length < 16) levels.pop();
  if (!levels[0].variants[0].list.length) return null;
  for (const L of levels) L.variants = L.variants.filter((v) => v.list.length > 0);
  const total = levels.length;
  let prev: LevelSynth | null = null;
  for (let l = total - 1; l >= 0; l--) {
    checkCancelled(progress);
    const S = new LevelSynth(levels[l], r, rand, bias);
    const coarsest = l === total - 1, finest = l === 0;
    const sched: Schedule = fast
      ? { em: coarsest ? 4 : finest ? 1 : 2, pm: coarsest ? 2 : 1, radius: coarsest ? 1 << 20 : 6 }
      : coarsest
        ? { em: 8, pm: 4, radius: 1 << 20 }
        : finest
          ? { em: 2, pm: 2, radius: Math.max(8, 4 * r) }
          : { em: 4, pm: 3, radius: Math.max(16, 8 * r) };
    // Very large holes: the coarser levels already fixed the structure, so the
    // expensive fine levels only refine detail.
    const nc = S.centers.length;
    if (!coarsest && nc > 150000) {
      sched.em = 1;
      sched.pm = 1;
    } else if (!coarsest && nc > 60000) {
      sched.em = Math.min(sched.em, 2);
      sched.pm = 1;
    } else if (!coarsest && !finest && nc > 20000) {
      sched.em = 3;
      sched.pm = 2;
    }
    if (prev) {
      S.initFrom(prev);
      S.vote(false);
    } else {
      S.diffuse();
      S.initRandom();
    }
    S.computeDistances();
    for (let e = 0; e < sched.em; e++) {
      for (let p = 0; p < sched.pm; p++) S.pass(((e * sched.pm + p) & 1) === 0, sched.radius);
      const last = finest && e === sched.em - 1;
      const { acc, wsum } = S.vote(true, last);
      if (last) {
        const { tw, th } = S.f, ring = new Float32Array(tw * th * 4).fill(NaN);
        for (let t = 0; t < tw * th; t++)
          if (!S.holeT[t] && wsum[t] > 0) for (let c = 0; c < 4; c++) ring[t * 4 + c] = acc[t * 4 + c] / wsum[t];
        return { rect: { x: S.f.x0, y: S.f.y0, width: tw, height: th }, fill: S.tgt, hole: S.holeT, ring };
      }
      S.computeDistances();
      checkCancelled(progress);
      progress?.report?.((total - 1 - l + (e + 1) / sched.em) / total);
    }
    prev = S;
  }
  return null;
}

// Seamless correction: harmonic interpolation of (original - synthesized) from
// the known pixels bordering the hole, added to the fill. Large differences mean
// the synthesized structure is misaligned there (an edge meeting the boundary),
// not a color shift, and spreading them would smear halos into the fill, so
// they fade to zero above `limit`.
function adaptColors(res: SynthResult, orig: Float32Array, limit: number) {
  const { width: tw, height: th } = res.rect, n = tw * th, type = new Uint8Array(n), val = new Float32Array(n * 4);
  for (let t = 0; t < n; t++) {
    if (res.hole[t]) {
      type[t] = UNKNOWN;
      continue;
    }
    const x = t % tw;
    const border = (x > 0 && res.hole[t - 1]) || (x < tw - 1 && res.hole[t + 1]) || (t >= tw && res.hole[t - tw]) || (t + tw < n && res.hole[t + tw]);
    if (border && res.ring && !Number.isNaN(res.ring[t * 4])) {
      type[t] = KNOWN;
      let m = 0;
      for (let c = 0; c < 4; c++) m = Math.max(m, Math.abs((val[t * 4 + c] = orig[t * 4 + c] - res.ring![t * 4 + c])));
      const k = Math.min(1, Math.max(0, (m - limit / 2) / (limit / 2))), wgt = 1 - k * k * (3 - 2 * k);
      for (let c = 0; c < 4; c++) val[t * 4 + c] *= wgt;
    }
  }
  solveMembrane(val, type, tw, th, 4, 1);
  for (let t = 0; t < n; t++) if (res.hole[t]) for (let c = 0; c < 4; c++) res.fill[t * 4 + c] = Math.min(255, Math.max(0, res.fill[t * 4 + c] + val[t * 4 + c]));
}

function crop(img: RGBA8, R: IRect): RGBA8 {
  const out = new Uint8ClampedArray(R.width * R.height * 4);
  for (let y = 0; y < R.height; y++) out.set(img.data.subarray(((y + R.y) * img.width + R.x) * 4, ((y + R.y) * img.width + R.x + R.width) * 4), y * R.width * 4);
  return { width: R.width, height: R.height, data: out };
}

function fillRegion(src: RGBA8, hole: Mask8, opts: ContextFillOptions & { inPlace?: boolean }, progress: Progress | undefined, fast: boolean, region?: IRect): RGBA8 {
  const { width: W, height: H } = src;
  if (hole.width !== W || hole.height !== H) throw new Error('Hole mask size differs from the image.');
  const out = opts.inPlace ? src : cloneRGBA8(src);
  const hb = boundingBox(hole);
  if (!hb) return out;
  const x0 = hb.x, y0 = hb.y, x1 = hb.x + hb.width - 1, y1 = hb.y + hb.height - 1;
  // Working region: the hole plus a margin (or the sampling area's extent).
  let R: IRect;
  if (region) R = region;
  else if (opts.sampling) {
    const sb = boundingBox(opts.sampling) ?? hb;
    const sx0 = Math.min(x0, sb.x), sy0 = Math.min(y0, sb.y), sx1 = Math.max(x1, sb.x + sb.width - 1), sy1 = Math.max(y1, sb.y + sb.height - 1);
    const pad = 8;
    R = { x: Math.max(0, sx0 - pad), y: Math.max(0, sy0 - pad), width: 0, height: 0 };
    R.width = Math.min(W, sx1 + pad + 1) - R.x;
    R.height = Math.min(H, sy1 + pad + 1) - R.y;
  } else {
    // Sources near the hole matter most; cap the margin so huge documents stay cheap.
    const m = Math.min(1024, Math.max(64, 3 * Math.max(x1 - x0 + 1, y1 - y0 + 1)));
    R = { x: Math.max(0, x0 - m), y: Math.max(0, y0 - m), width: 0, height: 0 };
    R.width = Math.min(W, x1 + m + 1) - R.x;
    R.height = Math.min(H, y1 + m + 1) - R.y;
  }
  const C = crop(src, R), n = R.width * R.height, hl = new Uint8Array(n), valid = new Uint8Array(n);
  let opaque = 0, cand = 0;
  for (let y = 0; y < R.height; y++)
    for (let x = 0; x < R.width; x++) {
      const i = (y + R.y) * W + x + R.x, j = y * R.width + x;
      hl[j] = hole.data[i] ? 1 : 0;
      valid[j] = !hl[j] && (!opts.sampling || opts.sampling.data[i] > 0) ? 1 : 0;
      if (valid[j]) {
        cand++;
        if (C.data[j * 4 + 3]) opaque++;
      }
    }
  // Prefer visible content as the source unless the surroundings are mostly empty.
  if (opaque > cand * 0.1) for (let j = 0; j < n; j++) if (valid[j] && !C.data[j * 4 + 3]) valid[j] = 0;
  const res = synthesize(C, hl, valid, opts, progress, fast);
  if (!res) return smoothFill(out, src, hole, R, hl);
  if ((opts.colorAdaptation ?? 'default') !== 'none') {
    const { width: tw, height: th } = res.rect, orig = new Float32Array(tw * th * 4);
    for (let y = 0; y < th; y++)
      for (let x = 0; x < tw; x++) {
        const j = ((y + res.rect.y) * R.width + x + res.rect.x) * 4, a = C.data[j + 3], t = (y * tw + x) * 4;
        orig[t] = (C.data[j] * a) / 255;
        orig[t + 1] = (C.data[j + 1] * a) / 255;
        orig[t + 2] = (C.data[j + 2] * a) / 255;
        orig[t + 3] = a;
      }
    adaptColors(res, orig, opts.colorAdaptation === 'high' ? 72 : 32);
  }
  progress?.report?.(1);
  // Composite with the hole's soft coverage, in premultiplied space.
  const { width: tw, height: th } = res.rect;
  for (let y = 0; y < th; y++)
    for (let x = 0; x < tw; x++) {
      const t = y * tw + x;
      if (!res.hole[t]) continue;
      const X = x + res.rect.x + R.x, Y = y + res.rect.y + R.y, i = Y * W + X, o = i * 4, m = hole.data[i] / 255;
      const sa = src.data[o + 3], fa = res.fill[t * 4 + 3];
      const a = sa * (1 - m) + fa * m;
      if (a <= 0) {
        out.data[o] = out.data[o + 1] = out.data[o + 2] = out.data[o + 3] = 0;
        continue;
      }
      for (let c = 0; c < 3; c++) out.data[o + c] = Math.round(((src.data[o + c] * sa) / 255 * (1 - m) + res.fill[t * 4 + c] * m) * 255 / a);
      out.data[o + 3] = Math.round(a);
    }
  return out;
}

// Fallback when no patch-sized source exists (tiny images or sampling areas):
// a smooth membrane fill from the surrounding pixels, so the hole still closes.
function smoothFill(out: RGBA8, src: RGBA8, hole: Mask8, R: IRect, hl: Uint8Array): RGBA8 {
  const n = R.width * R.height, type = new Uint8Array(n), val = new Float32Array(n * 4);
  let known = 0;
  for (let y = 0; y < R.height; y++)
    for (let x = 0; x < R.width; x++) {
      const j = y * R.width + x, o = ((y + R.y) * src.width + x + R.x) * 4, a = src.data[o + 3];
      if (hl[j]) type[j] = UNKNOWN;
      else {
        type[j] = KNOWN;
        known++;
        for (let c = 0; c < 3; c++) val[j * 4 + c] = (src.data[o + c] * a) / 255;
        val[j * 4 + 3] = a;
      }
    }
  if (!known) return out;
  solveMembrane(val, type, R.width, R.height, 4);
  for (let y = 0; y < R.height; y++)
    for (let x = 0; x < R.width; x++) {
      const j = y * R.width + x;
      if (!hl[j]) continue;
      const i = (y + R.y) * src.width + x + R.x, o = i * 4, m = hole.data[i] / 255, sa = src.data[o + 3];
      const a = sa * (1 - m) + val[j * 4 + 3] * m;
      for (let c = 0; c < 3; c++) out.data[o + c] = a > 0 ? Math.round(((((src.data[o + c] * sa) / 255) * (1 - m) + val[j * 4 + c] * m) * 255) / a) : 0;
      out.data[o + 3] = Math.round(a);
    }
  return out;
}

// Context Fill. `hole` coverage > 0 marks pixels to replace (soft coverage blends).
export function contextFill(src: RGBA8, hole: Mask8, opts: ContextFillOptions = {}, progress?: Progress): RGBA8 {
  return fillRegion(src, hole, opts, progress, false);
}

// Fast path for small dabs (Spot Healing Brush): a tight local region, fewer
// iterations and smaller patches for tiny holes.
// `inPlace` writes into `src` (no full-image copy per dab).
export function contextFillSmall(src: RGBA8, hole: Mask8, opts: ContextFillOptions & { inPlace?: boolean } = {}): RGBA8 {
  const hb = boundingBox(hole);
  if (!hb) return opts.inPlace ? src : cloneRGBA8(src);
  const x0 = hb.x, y0 = hb.y, x1 = hb.x + hb.width - 1, y1 = hb.y + hb.height - 1;
  const size = Math.max(x1 - x0 + 1, y1 - y0 + 1), m = Math.max(20, size);
  const R = { x: Math.max(0, x0 - m), y: Math.max(0, y0 - m), width: 0, height: 0 };
  R.width = Math.min(src.width, x1 + m + 1) - R.x;
  R.height = Math.min(src.height, y1 + m + 1) - R.y;
  return fillRegion(src, hole, { patchSize: 5, ...opts }, undefined, true, R);
}
