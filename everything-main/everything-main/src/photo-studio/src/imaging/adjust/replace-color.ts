// Replace Color: builds a soft mask from the CIE L*a*b* distance to a sampled
// color (fuzziness sets the falloff radius) and applies a hue/saturation/
// lightness shift through it.
import { checkCancelled, cloneRGBA8, mask8, type Mask8, type Progress, type RGBA8 } from '../types';
import { hslToRgb, rgbToHsl, rgbToLab, SRGB8_TO_LINEAR } from './color-math';

export type ReplaceColorParams = {
  color: [number, number, number]; // sampled color, 0..255
  fuzziness: number; // 0..200
  hue: number; // -180..180
  saturation: number; // -100..100
  lightness: number; // -100..100
};

// CIE f(t) with an interpolated cube-root table (error < 1e-5 in L*a*b* units).
const LAB_E = 216 / 24389;
const CBRT_N = 4096;
const cbrtTable = new Float32Array(CBRT_N + 2);
for (let i = 0; i <= CBRT_N + 1; i++) cbrtTable[i] = Math.cbrt(i / CBRT_N);
const cbrtF = (t: number) => {
  if (t <= LAB_E) return ((24389 / 27) * t + 16) / 116;
  if (t >= 1) return Math.cbrt(t);
  const p = t * CBRT_N,
    i = p | 0;
  return cbrtTable[i] + (cbrtTable[i + 1] - cbrtTable[i]) * (p - i);
};

// Coverage 0..255 of pixels near `color`: full inside fuzziness / 4 in Delta
// E, fading to zero at fuzziness / 2 (fuzziness 40 reaches 20 Delta E).
export function colorRangeMask(src: RGBA8, color: readonly number[], fuzziness: number): Mask8 {
  const lab = rgbToLab(color[0] / 255, color[1] / 255, color[2] / 255);
  const outer = Math.max(0.5, fuzziness / 2),
    inner = outer / 2;
  const m = mask8(src.width, src.height);
  const d = src.data;
  // XYZ rows of the sRGB matrix (D65), divided by the white point for Lab.
  const X = [0.4123908 / 0.95045592705, 0.35758434 / 0.95045592705, 0.18048079 / 0.95045592705];
  const Y = [0.21263901, 0.71516868, 0.07219232];
  const Z = [0.01933082 / 1.08905775076, 0.11919478 / 1.08905775076, 0.95053215 / 1.08905775076];
  for (let p = 0, i = 0; p < m.data.length; p++, i += 4) {
    const r = SRGB8_TO_LINEAR[d[i]],
      g = SRGB8_TO_LINEAR[d[i + 1]],
      b = SRGB8_TO_LINEAR[d[i + 2]];
    const fx = cbrtF(X[0] * r + X[1] * g + X[2] * b),
      fy = cbrtF(Y[0] * r + Y[1] * g + Y[2] * b),
      fz = cbrtF(Z[0] * r + Z[1] * g + Z[2] * b);
    const dl = 116 * fy - 16 - lab[0],
      da = 500 * (fx - fy) - lab[1],
      db = 200 * (fy - fz) - lab[2];
    const de = Math.sqrt(dl * dl + da * da + db * db);
    m.data[p] = de <= inner ? 255 : de >= outer ? 0 : Math.round((255 * (outer - de)) / (outer - inner));
  }
  return m;
}

export function replaceColor(src: RGBA8, p: ReplaceColorParams, selection?: Mask8, progress?: Progress): RGBA8 {
  const out = cloneRGBA8(src);
  const mask = colorRangeMask(src, p.color, Math.max(0, Math.min(200, p.fuzziness)));
  checkCancelled(progress);
  const dh = Math.max(-180, Math.min(180, p.hue)),
    ds = Math.max(-100, Math.min(100, p.saturation)) / 100,
    dl = Math.max(-100, Math.min(100, p.lightness)) / 100;
  if (!dh && !ds && !dl) return out;
  const s = src.data,
    d = out.data,
    sel = selection?.data;
  const hsl = new Float64Array(3),
    rgb = new Float64Array(3);
  for (let q = 0, i = 0; q < mask.data.length; q++, i += 4) {
    let m = mask.data[q];
    if (sel) m = (m * sel[q] + 127) / 255;
    if (m < 0.5) continue;
    rgbToHsl(s[i] / 255, s[i + 1] / 255, s[i + 2] / 255, hsl);
    const sat = ds >= 0 ? hsl[1] + (1 - hsl[1]) * ds * (hsl[1] > 0 ? 1 : 0) : hsl[1] * (1 + ds);
    const l = dl >= 0 ? hsl[2] + (1 - hsl[2]) * dl : hsl[2] * (1 + dl);
    hslToRgb(hsl[0] + dh, sat, l, rgb);
    const k = m / 255;
    for (let c = 0; c < 3; c++) d[i + c] = s[i + c] + (rgb[c] * 255 - s[i + c]) * k;
  }
  return out;
}
