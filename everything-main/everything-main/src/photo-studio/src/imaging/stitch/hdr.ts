// Merging bracketed exposures into one high-dynamic-range image: relative
// exposures estimated from the pixels, the camera response recovered per
// channel by least squares (Debevec and Malik 1997, "Recovering High Dynamic
// Range Radiance Maps from Photographs"), and a weighted average of each
// exposure's radiance estimate. Output is linear RGB in floating point.
import { checkCancelled, type Progress, type RGBA8, type RGBAF } from '../types';
import { srgbToLinear } from '../adjust/color-math';
import { solveLinear } from './estimate';

/** g[z] = ln(radiance × exposure) for code value z, one table per channel. */
export type Response = [Float32Array, Float32Array, Float32Array];

const hat = (z: number) => Math.min(z, 255 - z) + 1;
// Fixing g(128) to the sRGB curve keeps reference midtones at familiar values.
const ANCHOR = Math.log(srgbToLinear(128 / 255));

/** The sRGB transfer curve as a response (a good default for camera JPEGs). */
export function srgbResponse(): Response {
  const g = new Float32Array(256);
  for (let z = 0; z < 256; z++) g[z] = Math.log(Math.max(srgbToLinear(z / 255), 1e-5));
  return [g, Float32Array.from(g), Float32Array.from(g)];
}

const lumaCode = (d: Uint8ClampedArray, o: number) => 0.299 * d[o] + 0.587 * d[o + 1] + 0.114 * d[o + 2];

/** Relative exposures in stops (EV), from ratios of linearized pixel values
 * that are well exposed in both images of each brightness-adjacent pair. The
 * median exposure is 0; brighter images get positive values. */
export function estimateExposures(images: RGBA8[]): number[] {
  const n = images.length;
  if (n < 2) return images.map(() => 0);
  const lin = new Float32Array(256);
  for (let z = 0; z < 256; z++) lin[z] = srgbToLinear(z / 255);
  const mean = images.map((img) => {
    let s = 0,
      c = 0;
    for (let o = 0; o < img.data.length; o += 16) if (img.data[o + 3]) (s += lumaCode(img.data, o)), c++;
    return c ? s / c : 0;
  });
  const order = mean.map((_, i) => i).sort((a, b) => mean[a] - mean[b]);
  const ev = new Array(n).fill(0);
  for (let k = 1; k < n; k++) {
    const a = images[order[k - 1]],
      b = images[order[k]];
    const ratios: number[] = [];
    const step = Math.max(1, Math.floor(a.data.length / 4 / 60000)) * 4;
    for (let o = 0; o < Math.min(a.data.length, b.data.length); o += step) {
      if (!a.data[o + 3] || !b.data[o + 3]) continue;
      for (let c = 0; c < 3; c++) {
        const za = a.data[o + c],
          zb = b.data[o + c];
        if (za < 20 || za > 235 || zb < 20 || zb > 235) continue;
        ratios.push(lin[zb] / lin[za]);
      }
    }
    ratios.sort((x, y) => x - y);
    const r = ratios.length ? ratios[ratios.length >> 1] : 2;
    ev[order[k]] = ev[order[k - 1]] + Math.log2(Math.max(1.0001, r));
  }
  const sorted = [...ev].sort((x, y) => x - y);
  const mid = sorted[(n - 1) >> 1];
  return ev.map((v) => Math.round((v - mid) * 100) / 100);
}

/** Pixel locations spread over the brightness range of the middle exposure. */
function samplePixels(images: RGBA8[], ev: number[], count: number): number[] {
  const mid = ev.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0])[(ev.length - 1) >> 1][1];
  const img = images[mid];
  const n = img.width * img.height;
  const buckets: number[][] = Array.from({ length: 32 }, () => []);
  // Prefer locally smooth pixels (alignment and blur errors matter less).
  const stride = Math.max(1, Math.floor(n / 40000));
  for (let i = img.width + 1; i < n - img.width - 1; i += stride) {
    const o = i * 4;
    if (images.some((im) => im.data[o + 3] < 255)) continue;
    const z = lumaCode(img.data, o);
    const g = Math.abs(z - lumaCode(img.data, o + 4)) + Math.abs(z - lumaCode(img.data, o + img.width * 4));
    if (g > 12) continue;
    buckets[Math.min(31, Math.floor(z / 8))].push(i);
  }
  const per = Math.ceil(count / 32);
  const out: number[] = [];
  for (const b of buckets) {
    const take = Math.min(per, b.length);
    for (let k = 0; k < take; k++) out.push(b[Math.floor(((k + 0.5) * b.length) / take)]);
  }
  return out;
}

/** Recover the response curve of each channel from the exposure stack. */
export function solveResponse(images: RGBA8[], ev: number[], opts: { samples?: number; smoothness?: number } = {}): Response {
  const lambda = opts.smoothness ?? 30;
  const pixels = samplePixels(images, ev, opts.samples ?? 160);
  const P = images.length,
    N = pixels.length;
  if (N < 8 || P < 2) return srgbResponse();
  const lnT = ev.map((v) => v * Math.LN2);
  const out: Float32Array[] = [];
  for (let c = 0; c < 3; c++) {
    // Normal equations of the sparse least-squares system (unknowns g[0..255], ln E[0..N)).
    const U = 256 + N;
    const ata = new Float64Array(U * U),
      atb = new Float64Array(U);
    const addRow = (idx: number[], val: number[], rhs: number) => {
      for (let a = 0; a < idx.length; a++) {
        atb[idx[a]] += val[a] * rhs;
        for (let b = 0; b < idx.length; b++) ata[idx[a] * U + idx[b]] += val[a] * val[b];
      }
    };
    for (let i = 0; i < N; i++)
      for (let j = 0; j < P; j++) {
        const z = images[j].data[pixels[i] * 4 + c];
        const w = hat(z);
        addRow([z, 256 + i], [w, -w], w * lnT[j]);
      }
    addRow([128], [100], 100 * ANCHOR);
    for (let z = 1; z < 255; z++) {
      const w = lambda * hat(z);
      addRow([z - 1, z, z + 1], [w, -2 * w, w], 0);
    }
    // Codes never observed are pinned weakly to the sRGB curve.
    for (let z = 0; z < 256; z++) {
      const w = 0.01;
      addRow([z], [w], w * Math.log(Math.max(srgbToLinear(z / 255), 1e-5)));
    }
    const x = solveLinear(ata, atb, U);
    const g = new Float32Array(256);
    if (!x) return srgbResponse();
    for (let z = 0; z < 256; z++) g[z] = x[z];
    // The response of a camera never decreases.
    for (let z = 1; z < 256; z++) if (g[z] <= g[z - 1]) g[z] = g[z - 1] + 1e-4;
    out.push(g);
  }
  return out as Response;
}

export type MergeOptions = {
  // Exclude exposures that disagree with the reference (moving subjects).
  removeGhosts?: boolean;
  // Image used as the ghost-free reference (default: the middle exposure).
  reference?: number;
  progress?: Progress;
};

/** Merge aligned exposures (same size) into linear floating-point RGBA. */
export function mergeHdr(images: RGBA8[], ev: number[], response: Response, opts: MergeOptions = {}): RGBAF {
  const { width: w, height: h } = images[0];
  const n = w * h;
  const P = images.length;
  const lnT = ev.map((v) => v * Math.LN2);
  const order = ev.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
  const darkest = order[0],
    brightest = order[P - 1];
  const ref = opts.reference ?? order[(P - 1) >> 1];
  const out = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    if ((i & 0xffff) === 0) {
      checkCancelled(opts.progress);
      opts.progress?.report?.(i / n);
    }
    const o = i * 4;
    let alpha = 1;
    for (let j = 0; j < P; j++) alpha = Math.min(alpha, images[j].data[o + 3] / 255);
    // Ghost check against the reference's radiance where it is well exposed.
    let refLn = NaN;
    if (opts.removeGhosts) {
      const z = lumaCode(images[ref].data, o);
      if (z > 12 && z < 243) refLn = lnRadiance(images[ref].data, o, response) - lnT[ref];
    }
    for (let c = 0; c < 3; c++) {
      let num = 0,
        den = 0;
      for (let j = 0; j < P; j++) {
        const z = images[j].data[o + c];
        let wt = hat(z) - 1;
        if (wt <= 0) continue;
        if (!Number.isNaN(refLn) && j !== ref) {
          const lz = lumaCode(images[j].data, o);
          if (lz > 8 && lz < 247 && Math.abs(lnRadiance(images[j].data, o, response) - lnT[j] - refLn) > 0.7) continue;
        }
        if (!Number.isNaN(refLn) && j === ref) wt *= 1.5;
        num += wt * (response[c][z] - lnT[j]);
        den += wt;
      }
      let v: number;
      if (den > 0) v = num / den;
      else {
        // Clipped in every exposure: bright pixels use the darkest image,
        // dark ones the brightest.
        const zd = images[darkest].data[o + c];
        v = zd >= 128 ? response[c][zd] - lnT[darkest] : response[c][images[brightest].data[o + c]] - lnT[brightest];
      }
      out[o + c] = Math.exp(v);
    }
    out[o + 3] = alpha;
  }
  opts.progress?.report?.(1);
  return { width: w, height: h, data: out };
}

function lnRadiance(d: Uint8ClampedArray, o: number, r: Response) {
  return 0.299 * r[0][d[o]] + 0.587 * r[1][d[o + 1]] + 0.114 * r[2][d[o + 2]];
}
