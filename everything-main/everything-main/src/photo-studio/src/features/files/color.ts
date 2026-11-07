// Convert document-space RGBA samples to sRGB for export with table lookups:
// decode each channel through the source TRC, apply the 3×3 matrix, then
// re-encode through a dense table of the inverse sRGB curve.
import { colorTransform, curveValue, linearSrgbProfile, readRgbProfile, srgbProfile, type RgbProfile } from '../../color/profile';
import { decodeIccProfile } from '../../model/psd-resources';
import type { PhotoDocument } from '../../model/document';

/** The document's working profile, or null for plain (encoded) sRGB. */
export function documentProfile(doc: Pick<PhotoDocument, 'iccProfile' | 'iccUntaggedProfile' | 'bitsPerChannel'>): RgbProfile | null {
  if (doc.iccProfile && !doc.iccUntaggedProfile) {
    try {
      return readRgbProfile(decodeIccProfile(doc.iccProfile));
    } catch {
      return null; // Displayed as sRGB too; see Renderer.configureProfile.
    }
  }
  // Untagged float documents hold linear sRGB.
  return doc.bitsPerChannel === 32 ? linearSrgbProfile : null;
}

const OUT = 4096;
/** Convert straight RGBA (8- or 16-bit) from `profile` to sRGB in place. */
export function convertToSrgb<T extends Uint8ClampedArray | Uint16Array>(data: T, profile: RgbProfile): T {
  const max = data instanceof Uint16Array ? 65535 : 255;
  const t = colorTransform(profile, srgbProfile);
  const lin = t.input.map((curve) => {
    const table = new Float32Array(max + 1);
    for (let i = 0; i <= max; i++) table[i] = curveValue(curve, i / max);
    return table;
  });
  const enc = new Float32Array(OUT + 1);
  for (let i = 0; i <= OUT; i++) enc[i] = curveValue(srgbProfile.curves[0], i / OUT, true) * max;
  const m = t.matrix;
  const encode = (v: number) => {
    if (v <= 0) return 0;
    if (v >= 1) return max;
    const x = v * OUT,
      i = x | 0;
    return Math.round(enc[i] + (enc[i + 1] - enc[i]) * (x - i));
  };
  const [lr, lg, lb] = lin;
  for (let i = 0; i < data.length; i += 4) {
    const r = lr[data[i]],
      g = lg[data[i + 1]],
      b = lb[data[i + 2]];
    data[i] = encode(m[0] * r + m[1] * g + m[2] * b);
    data[i + 1] = encode(m[3] * r + m[4] * g + m[5] * b);
    data[i + 2] = encode(m[6] * r + m[7] * g + m[8] * b);
  }
  return data;
}

/** Float document samples (linear or encoded, alpha in [0,1]) to 16-bit codes. */
export function floatTo16(samples: Float32Array): Uint16Array {
  const out = new Uint16Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = Math.round(Math.max(0, Math.min(1, samples[i])) * 65535);
  return out;
}
