// Colorimetric primitives shared by the color-management modules: CIE XYZ and
// L*a*b* conversions, chromatic adaptation, primaries-to-matrix derivation and
// the PCS Lab encodings of ICC.1 (v2 legacy 16-bit, v4 16-bit and 8-bit).
// All XYZ values are scaled so the perfect diffuser has Y = 1.
import { inverseMatrix, multiplyMatrix } from './profile';

export type Vec3 = [number, number, number];
export type Mat3 = number[];

// ICC PCS illuminant (D50) as encoded in profile headers (s15Fixed16 rounded).
export const D50: Vec3 = [0.9642, 1, 0.8249];
export const D65: Vec3 = [0.95047, 1, 1.08883];
// v4 perceptual reference medium black (ICC.1:2010 section 6.3.4.3).
export const PERCEPTUAL_BLACK: Vec3 = [0.00336, 0.0034731, 0.00287];

export const mat3Vec = (m: Mat3, v: ArrayLike<number>): Vec3 => [
  m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
  m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
  m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
];
export const mat3Mul = multiplyMatrix;
export const mat3Inv = inverseMatrix;
export const IDENTITY3: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export const xyToXYZ = (x: number, y: number): Vec3 => [x / y, 1, (1 - x - y) / y];

// Bradford cone response (Lam 1985), the adaptation ICC.1 Annex E recommends.
export const BRADFORD: Mat3 = [
  0.8951, 0.2664, -0.1614, -0.7502, 1.7135, 0.0367, 0.0389, -0.0685, 1.0296,
];
// Linear von Kries scaling in Bradford's sharpened cone space.
export function bradfordMatrix(srcWhite: ArrayLike<number>, dstWhite: ArrayLike<number>): Mat3 {
  const s = mat3Vec(BRADFORD, srcWhite),
    d = mat3Vec(BRADFORD, dstWhite);
  const scaled = BRADFORD.map((n, i) => (n * d[Math.floor(i / 3)]) / s[Math.floor(i / 3)]);
  return mat3Mul(mat3Inv(BRADFORD), scaled);
}

// RGB -> XYZ (in the native white) from chromaticities, then adapted to D50 so
// the columns are valid ICC colorants (rXYZ, gXYZ, bXYZ).
export function rgbToXYZMatrix(
  primaries: [[number, number], [number, number], [number, number]],
  white: [number, number],
  adaptTo: Vec3 | null = D50,
): Mat3 {
  const cols = primaries.map(([x, y]) => xyToXYZ(x, y));
  const p = [0, 1, 2].flatMap((r) => cols.map((c) => c[r]));
  const w = xyToXYZ(white[0], white[1]);
  const s = mat3Vec(mat3Inv(p), w);
  const m = p.map((n, i) => n * s[i % 3]);
  return adaptTo ? mat3Mul(bradfordMatrix(w, adaptTo), m) : m;
}

const EPS = 216 / 24389,
  KAPPA = 24389 / 27;
const f = (t: number) => (t > EPS ? Math.cbrt(t) : (KAPPA * t + 16) / 116);
const finv = (t: number) => (t * t * t > EPS ? t * t * t : (116 * t - 16) / KAPPA);
export function xyzToLab(xyz: ArrayLike<number>, white: ArrayLike<number> = D50, out: number[] | Float64Array = [0, 0, 0]) {
  const fx = f(xyz[0] / white[0]),
    fy = f(xyz[1] / white[1]),
    fz = f(xyz[2] / white[2]);
  out[0] = 116 * fy - 16;
  out[1] = 500 * (fx - fy);
  out[2] = 200 * (fy - fz);
  return out;
}
export function labToXYZ(lab: ArrayLike<number>, white: ArrayLike<number> = D50, out: number[] | Float64Array = [0, 0, 0]) {
  const fy = (lab[0] + 16) / 116,
    fx = fy + lab[1] / 500,
    fz = fy - lab[2] / 200;
  out[0] = white[0] * finv(fx);
  out[1] = white[1] * (lab[0] > KAPPA * EPS ? fy * fy * fy : lab[0] / KAPPA);
  out[2] = white[2] * finv(fz);
  return out;
}

// ICC PCS encodings, normalized to [0, 1] (encoded integer / max integer).
// v4 (and every 8-bit) Lab: L = n * 100, a/b = n * 255 - 128.
// v2 legacy 16-bit Lab (lut16Type in any version): 0xFF00 is L = 100 and
// a = 0 at 0x8000, so the scale is 65535/65280 of the v4 one.
// XYZ: u1Fixed15, 0x8000 = 1.0, so XYZ = n * 65535 / 32768.
export type LabEncoding = 'v4' | 'legacy';
const LEGACY = 65535 / 65280;
export function decodeLab(n: ArrayLike<number>, enc: LabEncoding, out: number[] | Float64Array = [0, 0, 0]) {
  if (enc === 'v4') {
    out[0] = n[0] * 100;
    out[1] = n[1] * 255 - 128;
    out[2] = n[2] * 255 - 128;
  } else {
    out[0] = n[0] * 100 * LEGACY;
    out[1] = n[1] * 255 * LEGACY - 128;
    out[2] = n[2] * 255 * LEGACY - 128;
  }
  return out;
}
export function encodeLab(lab: ArrayLike<number>, enc: LabEncoding, out: number[] | Float64Array = [0, 0, 0]) {
  const s = enc === 'v4' ? 1 : 1 / LEGACY;
  out[0] = clamp01((lab[0] / 100) * s);
  out[1] = clamp01(((lab[1] + 128) / 255) * s);
  out[2] = clamp01(((lab[2] + 128) / 255) * s);
  return out;
}
export const XYZ_SCALE = 65535 / 32768;

export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);

export function lchFromLab(lab: ArrayLike<number>): Vec3 {
  const c = Math.hypot(lab[1], lab[2]);
  let h = (Math.atan2(lab[2], lab[1]) * 180) / Math.PI;
  if (h < 0) h += 360;
  return [lab[0], c, h];
}
