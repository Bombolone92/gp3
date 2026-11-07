// Match Color: statistical color transfer in CIE L*a*b* (Reinhard, Ashikhmin,
// Gooch and Shirley, "Color Transfer between Images", IEEE CG&A 2001), with
// luminance, color intensity, fade and neutralize controls. The per-pixel
// mapping is smooth, so it is baked into a 3D table and applied through the
// Color Lookup adjustment (trilinear, within about one code value).
import { bakeCubeLut, labToRgb, rgbToLab, type CubeLut } from '../../imaging/adjust';
import type { RGBA8 } from '../../imaging/types';

export type LabStats = { mean: [number, number, number]; std: [number, number, number]; count: number };
export type MatchOptions = { luminance: number; intensity: number; fade: number; neutralize: boolean };
export const DEFAULT_MATCH: MatchOptions = { luminance: 100, intensity: 100, fade: 0, neutralize: false };

/** Mean and standard deviation of L*, a*, b* over opaque (and, with a
 * coverage mask, at least half selected) pixels; large images are sampled
 * on a regular grid of about 250 000 pixels. */
export function labStats(img: RGBA8, cover?: Uint8Array): LabStats {
  const n = img.width * img.height;
  const step = Math.max(1, Math.floor(Math.sqrt(n / 250_000)));
  const sum = [0, 0, 0],
    sq = [0, 0, 0],
    lab = [0, 0, 0];
  let count = 0;
  const d = img.data;
  for (let y = 0; y < img.height; y += step)
    for (let x = 0; x < img.width; x += step) {
      const p = y * img.width + x,
        i = p * 4;
      if (d[i + 3] === 0 || (cover && cover[p] < 128)) continue;
      rgbToLab(d[i] / 255, d[i + 1] / 255, d[i + 2] / 255, lab);
      for (let k = 0; k < 3; k++) {
        sum[k] += lab[k];
        sq[k] += lab[k] * lab[k];
      }
      count++;
    }
  if (!count) return { mean: [50, 0, 0], std: [1, 1, 1], count: 0 };
  const mean = sum.map((s) => s / count) as LabStats['mean'];
  const std = sq.map((s, k) => Math.sqrt(Math.max(0, s / count - mean[k] * mean[k]))) as LabStats['std'];
  return { mean, std, count };
}

/** Color function mapping target statistics onto source statistics (or
 * leaving them when there is no source), then applying the options. */
export function matchFunction(target: LabStats, source: LabStats | null, o: MatchOptions) {
  const ratio = (k: number) => (source && target.std[k] > 1e-3 ? source.std[k] / target.std[k] : 1);
  const r = [ratio(0), ratio(1), ratio(2)];
  const to = source ? source.mean : target.mean;
  const lab = [0, 0, 0],
    rgb = [0, 0, 0];
  const lum = o.luminance / 100,
    chroma = o.intensity / 100,
    keep = o.fade / 100;
  return (R: number, G: number, B: number, out: Float64Array | number[]) => {
    rgbToLab(R, G, B, lab);
    let L = (lab[0] - target.mean[0]) * r[0] + to[0];
    let a = (lab[1] - target.mean[1]) * r[1] + to[1];
    let b = (lab[2] - target.mean[2]) * r[2] + to[2];
    // Neutralize removes the average cast, centering chroma on gray.
    if (o.neutralize) {
      a -= to[1];
      b -= to[2];
    }
    L = Math.min(100, Math.max(0, L * lum));
    labToRgb(L, a * chroma, b * chroma, rgb);
    for (let k = 0; k < 3; k++) {
      const v = Math.min(1, Math.max(0, rgb[k])),
        orig = k === 0 ? R : k === 1 ? G : B;
      out[k] = v + (orig - v) * keep;
    }
  };
}

export function matchColorLut(target: LabStats, source: LabStats | null, o: MatchOptions, size = 33): CubeLut {
  const f = matchFunction(target, source, o);
  return bakeCubeLut((r, g, b, out) => f(r, g, b, out), size, 'Match Color');
}
