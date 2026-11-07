// Salient-object map without learned models: Minimum Barrier Distance to the image
// border (Zhang, Sclaroff, Lin, Shen, Price and Mech, "Minimum Barrier Salient
// Object Detection at 80 FPS", ICCV 2015, the FastMBD raster-scan approximation)
// plus their border-contrast "backgroundness" cue and center bias. Output in [0, 1].
import type { RGBA8 } from '../types';
import { rgbToLab } from './color-select';

export function labPlanes(img: RGBA8) {
  const n = img.width * img.height, L = new Float32Array(n), A = new Float32Array(n), B = new Float32Array(n), lab = new Float32Array(3), d = img.data;
  for (let i = 0; i < n; i++) {
    const a = d[i * 4 + 3] / 255;
    rgbToLab(Math.round(d[i * 4] * a), Math.round(d[i * 4 + 1] * a), Math.round(d[i * 4 + 2] * a), lab);
    L[i] = lab[0];
    A[i] = lab[1];
    B[i] = lab[2];
  }
  return [L, A, B] as const;
}

function fastMBD(I: Float32Array, w: number, h: number, passes = 3) {
  const n = w * h, D = new Float32Array(n).fill(Infinity), U = new Float32Array(I), Lo = new Float32Array(I);
  for (let x = 0; x < w; x++) D[x] = D[(h - 1) * w + x] = 0;
  for (let y = 0; y < h; y++) D[y * w] = D[y * w + w - 1] = 0;
  const relax = (p: number, q: number) => {
    const v = I[p], u = U[q] > v ? U[q] : v, l = Lo[q] < v ? Lo[q] : v;
    if (u - l < D[p]) {
      D[p] = u - l;
      U[p] = u;
      Lo[p] = l;
    }
  };
  for (let it = 0; it < passes; it++) {
    for (let y = 1; y < h - 1; y++)
      for (let x = 1; x < w - 1; x++) {
        const p = y * w + x;
        relax(p, p - 1);
        relax(p, p - w);
      }
    for (let y = h - 2; y >= 1; y--)
      for (let x = w - 2; x >= 1; x--) {
        const p = y * w + x;
        relax(p, p + 1);
        relax(p, p + w);
      }
  }
  return D;
}

function normalize(a: Float32Array) {
  let mx = 0;
  for (let i = 0; i < a.length; i++) if (a[i] > mx && a[i] !== Infinity) mx = a[i];
  if (mx > 0) for (let i = 0; i < a.length; i++) a[i] = Math.min(1, a[i] / mx);
  return a;
}

// Mahalanobis distance of every pixel to each border strip's color distribution;
// the strip most unlike the others (likely touching the subject) is dropped.
function backgroundness(P: readonly Float32Array[], w: number, h: number) {
  const n = w * h, bw = Math.max(1, Math.round(Math.min(w, h) * 0.06));
  const strips: ((x: number, y: number) => boolean)[] = [
    (_x, y) => y < bw, (_x, y) => y >= h - bw, (x) => x < bw, (x) => x >= w - bw,
  ];
  const maps: Float32Array[] = [];
  for (const inStrip of strips) {
    const s = new Float64Array(9 + 3);
    let c = 0;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        if (!inStrip(x, y)) continue;
        const i = y * w + x, a = P[0][i], b = P[1][i], d = P[2][i];
        s[0] += a; s[1] += b; s[2] += d;
        s[3] += a * a; s[4] += a * b; s[5] += a * d; s[6] += b * b; s[7] += b * d; s[8] += d * d;
        c++;
      }
    const m0 = s[0] / c, m1 = s[1] / c, m2 = s[2] / c, reg = 1;
    const A = s[3] / c - m0 * m0 + reg, B = s[4] / c - m0 * m1, C = s[5] / c - m0 * m2;
    const D = s[6] / c - m1 * m1 + reg, E = s[7] / c - m1 * m2, F = s[8] / c - m2 * m2 + reg;
    const i00 = D * F - E * E, i01 = E * C - B * F, i02 = B * E - D * C, i11 = A * F - C * C, i12 = C * B - A * E, i22 = A * D - B * B;
    const det = A * i00 + B * i01 + C * i02;
    const map = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = P[0][i] - m0, y = P[1][i] - m1, z = P[2][i] - m2;
      const md = (x * (i00 * x + i01 * y + i02 * z) + y * (i01 * x + i11 * y + i12 * z) + z * (i02 * x + i12 * y + i22 * z)) / det;
      map[i] = Math.sqrt(Math.max(0, md));
    }
    maps.push(normalize(map));
  }
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0, mx = 0;
    for (const m of maps) {
      s += m[i];
      if (m[i] > mx) mx = m[i];
    }
    out[i] = s - mx;
  }
  return normalize(out);
}

// Saliency of a small image (callers downscale to ~300 px first). `centerBias`
// (0..1) favors the middle of the frame; lower it to find objects anywhere.
export function saliency(img: RGBA8, centerBias = 0.6): Float32Array {
  const { width: w, height: h } = img, n = w * h, P = labPlanes(img);
  const S = new Float32Array(n);
  if (w < 3 || h < 3) return S;
  // a*, b* have a smaller natural range than L*; weight them up a little.
  const weights = [1, 1.5, 1.5];
  for (let c = 0; c < 3; c++) {
    const scaled = new Float32Array(n);
    for (let i = 0; i < n; i++) scaled[i] = P[c][i] * weights[c];
    const d = fastMBD(scaled, w, h);
    for (let i = 0; i < n; i++) S[i] += d[i];
  }
  normalize(S);
  const Bk = backgroundness(P, w, h);
  const cx = w / 2, cy = h / 2, md = Math.hypot(cx, cy);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const center = 1 - Math.hypot(x - cx, y - cy) / md;
      S[i] = (S[i] + Bk[i]) * (1 - centerBias + centerBias * center);
    }
  normalize(S);
  // Contrast enhancement from the paper: a sigmoid centered on the adaptive threshold.
  const t = otsu(S);
  for (let i = 0; i < n; i++) S[i] = 1 / (1 + Math.exp(-10 * (S[i] - t)));
  return S;
}

// Otsu threshold of values in [0, 1].
export function otsu(v: Float32Array) {
  const hist = new Float64Array(256);
  for (let i = 0; i < v.length; i++) hist[Math.min(255, Math.max(0, Math.floor(v[i] * 255)))]++;
  let total = 0, sumAll = 0;
  for (let k = 0; k < 256; k++) {
    total += hist[k];
    sumAll += k * hist[k];
  }
  let wB = 0, sumB = 0, best = 0, bestT = 128;
  for (let k = 0; k < 256; k++) {
    wB += hist[k];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += k * hist[k];
    const mB = sumB / wB, mF = (sumAll - sumB) / wF, between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) {
      best = between;
      bestT = k;
    }
  }
  return (bestT + 0.5) / 255;
}
