// Color math shared by the adjustments: the sRGB transfer function
// (IEC 61966-2-1), HSL/HSB, CIE XYZ and CIE L*a*b* with sRGB primaries and the
// D65 white point. All channel values are floats in [0, 1] unless noted; hue is
// in degrees [0, 360). Conversions write into `out` so hot loops never allocate.
export type Vec3 = number[] | Float64Array | Float32Array;

// Rec. 709 / sRGB luminance weights. Applied to encoded values they give the
// "luma" used for Threshold, Gradient Map, histograms and luminosity blending.
export const LUMA_R = 0.2126;
export const LUMA_G = 0.7152;
export const LUMA_B = 0.0722;
export const luma = (r: number, g: number, b: number) => LUMA_R * r + LUMA_G * g + LUMA_B * b;
// Same weights in 16-bit fixed point (they sum to exactly 65536) for 8-bit codes.
export const luma8 = (r: number, g: number, b: number) => (13933 * r + 46871 * g + 4732 * b + 32768) >> 16;

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

export function srgbToLinear(v: number): number {
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}
export function linearToSrgb(v: number): number {
  return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}

// Exact decode table for 8-bit codes.
export const SRGB8_TO_LINEAR = new Float32Array(256);
for (let i = 0; i < 256; i++) SRGB8_TO_LINEAR[i] = srgbToLinear(i / 255);

// Interpolated tables for the per-pixel paths: error stays below 0.01 code
// values, and they avoid two Math.pow calls per channel.
const FAST_N = 4096;
const LOW_N = 2048,
  LOW_MAX = 1 / 64;
const toLinTable = new Float32Array(FAST_N + 1);
const toSrgbTable = new Float32Array(FAST_N + 1);
// The bottom of the encode curve is too steep for the coarse table.
const toSrgbLow = new Float32Array(LOW_N + 1);
for (let i = 0; i <= FAST_N; i++) {
  toLinTable[i] = srgbToLinear(i / FAST_N);
  toSrgbTable[i] = linearToSrgb(i / FAST_N);
}
for (let i = 0; i <= LOW_N; i++) toSrgbLow[i] = linearToSrgb((i / LOW_N) * LOW_MAX);
// Domain [0, 1], clamped.
export function srgbToLinearFast(v: number): number {
  if (!(v > 0)) return 0;
  if (v >= 1) return 1;
  const p = v * FAST_N,
    i = p | 0;
  return toLinTable[i] + (toLinTable[i + 1] - toLinTable[i]) * (p - i);
}
export function linearToSrgbFast(v: number): number {
  if (!(v > 0)) return 0;
  if (v >= 1) return 1;
  if (v < 0.0031308) return v * 12.92;
  if (v < LOW_MAX) {
    const p = v * (LOW_N / LOW_MAX),
      i = p | 0;
    return toSrgbLow[i] + (toSrgbLow[i + 1] - toSrgbLow[i]) * (p - i);
  }
  const p = v * FAST_N,
    i = p | 0;
  return toSrgbTable[i] + (toSrgbTable[i + 1] - toSrgbTable[i]) * (p - i);
}

export function rgbToHsl(r: number, g: number, b: number, out: Vec3 = [0, 0, 0]): Vec3 {
  const max = r > g ? (r > b ? r : b) : g > b ? g : b;
  const min = r < g ? (r < b ? r : b) : g < b ? g : b;
  const l = (max + min) / 2,
    d = max - min;
  let h = 0,
    s = 0;
  if (d > 0) {
    s = l <= 0.5 ? d / (max + min) : d / (2 - max - min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  out[0] = h;
  out[1] = s;
  out[2] = l;
  return out;
}

// Shared by HSL and HSB: chroma c around hue h, offset by m. Avoids the float
// % operator, which is very slow in V8 hot loops.
function fromHueChroma(h: number, c: number, m: number, out: Vec3): Vec3 {
  if (h < 0 || h >= 360) h -= 360 * Math.floor(h / 360);
  const hp = h / 60,
    sector = hp | 0,
    f = hp - sector;
  const x = c * (sector & 1 ? 1 - f : f);
  let r = 0,
    g = 0,
    b = 0;
  switch (sector) {
    case 0:
      (r = c), (g = x);
      break;
    case 1:
      (r = x), (g = c);
      break;
    case 2:
      (g = c), (b = x);
      break;
    case 3:
      (g = x), (b = c);
      break;
    case 4:
      (r = x), (b = c);
      break;
    default:
      (r = c), (b = x);
  }
  out[0] = r + m;
  out[1] = g + m;
  out[2] = b + m;
  return out;
}
export function hslToRgb(h: number, s: number, l: number, out: Vec3 = [0, 0, 0]): Vec3 {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  return fromHueChroma(h, c, l - c / 2, out);
}

export function rgbToHsb(r: number, g: number, b: number, out: Vec3 = [0, 0, 0]): Vec3 {
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  out[0] = h;
  out[1] = max > 0 ? d / max : 0;
  out[2] = max;
  return out;
}
export function hsbToRgb(h: number, s: number, v: number, out: Vec3 = [0, 0, 0]): Vec3 {
  const c = v * s;
  return fromHueChroma(h, c, v - c, out);
}

// sRGB primaries, D65 (IEC 61966-2-1 matrix as used by CSS Color 4).
const M_TO_XYZ = [0.4123908, 0.35758434, 0.18048079, 0.21263901, 0.71516868, 0.07219232, 0.01933082, 0.11919478, 0.95053215];
// Exact inverse so XYZ round trips are lossless to float precision.
const M_TO_RGB = (() => {
  const [a, b, c, d, e, f, g, h, i] = M_TO_XYZ;
  const adj = [e * i - f * h, c * h - b * i, b * f - c * e, f * g - d * i, a * i - c * g, c * d - a * f, d * h - e * g, b * g - a * h, a * e - b * d];
  const det = a * adj[0] + b * adj[3] + c * adj[6];
  return adj.map((v) => v / det);
})();
export const D65_WHITE = [0.95045592705, 1, 1.08905775076];

// Encoded sRGB in [0, 1] to CIE XYZ (Y of white = 1).
export function rgbToXyz(r: number, g: number, b: number, out: Vec3 = [0, 0, 0]): Vec3 {
  const lr = srgbToLinear(r),
    lg = srgbToLinear(g),
    lb = srgbToLinear(b);
  out[0] = M_TO_XYZ[0] * lr + M_TO_XYZ[1] * lg + M_TO_XYZ[2] * lb;
  out[1] = M_TO_XYZ[3] * lr + M_TO_XYZ[4] * lg + M_TO_XYZ[5] * lb;
  out[2] = M_TO_XYZ[6] * lr + M_TO_XYZ[7] * lg + M_TO_XYZ[8] * lb;
  return out;
}
// Returns encoded sRGB; values outside [0, 1] are out of gamut and not clamped.
export function xyzToRgb(x: number, y: number, z: number, out: Vec3 = [0, 0, 0]): Vec3 {
  out[0] = linearToSrgb(M_TO_RGB[0] * x + M_TO_RGB[1] * y + M_TO_RGB[2] * z);
  out[1] = linearToSrgb(M_TO_RGB[3] * x + M_TO_RGB[4] * y + M_TO_RGB[5] * z);
  out[2] = linearToSrgb(M_TO_RGB[6] * x + M_TO_RGB[7] * y + M_TO_RGB[8] * z);
  return out;
}

// CIE 1976 L*a*b* (L in [0, 100]) relative to D65.
const LAB_E = 216 / 24389,
  LAB_K = 24389 / 27;
const labF = (t: number) => (t > LAB_E ? Math.cbrt(t) : (LAB_K * t + 16) / 116);
const labFInv = (t: number) => (t * t * t > LAB_E ? t * t * t : (116 * t - 16) / LAB_K);
export function xyzToLab(x: number, y: number, z: number, out: Vec3 = [0, 0, 0]): Vec3 {
  const fx = labF(x / D65_WHITE[0]),
    fy = labF(y),
    fz = labF(z / D65_WHITE[2]);
  out[0] = 116 * fy - 16;
  out[1] = 500 * (fx - fy);
  out[2] = 200 * (fy - fz);
  return out;
}
export function labToXyz(l: number, a: number, b: number, out: Vec3 = [0, 0, 0]): Vec3 {
  const fy = (l + 16) / 116,
    fx = fy + a / 500,
    fz = fy - b / 200;
  out[0] = labFInv(fx) * D65_WHITE[0];
  out[1] = l > LAB_K * LAB_E ? fy * fy * fy : l / LAB_K;
  out[2] = labFInv(fz) * D65_WHITE[2];
  return out;
}
export function rgbToLab(r: number, g: number, b: number, out: Vec3 = [0, 0, 0]): Vec3 {
  rgbToXyz(r, g, b, out);
  return xyzToLab(out[0], out[1], out[2], out);
}
export function labToRgb(l: number, a: number, b: number, out: Vec3 = [0, 0, 0]): Vec3 {
  labToXyz(l, a, b, out);
  return xyzToRgb(out[0], out[1], out[2], out);
}

// Hex helpers for ParamSpec colors ('#rrggbb').
export function hexToRgb8(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function rgb8ToHex(c: readonly number[]): string {
  return '#' + c.slice(0, 3).map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('');
}
