// Display simulations used by View > Proof Setup: individual ink plates of a
// CMYK separation and color vision deficiencies. Pure math; the proof feature
// bakes these into the display 3D LUT, so document pixels never change.
import type { Lut3D } from './transform';

export type VisionKind = 'protan' | 'deutan';
export type Plate = 'c' | 'm' | 'y' | 'k';
export type Mat3 = readonly [number, number, number, number, number, number, number, number, number];

// Dichromat simulation matrices (severity 1.0) from Machado, Oliveira and
// Fernandes, "A Physiologically-based Model for Simulation of Color Vision
// Deficiency", IEEE Transactions on Visualization and Computer Graphics
// 15(6):1291-1298, 2009 (table of precomputed matrices). They operate on
// linear RGB with Rec. 709 / sRGB primaries; each row sums to 1, so neutral
// grays are unchanged.
export const VISION_MATRICES: Record<VisionKind, Mat3> = {
  protan: [0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998],
  deutan: [0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.01182, 0.04294, 0.968881],
};
export const VISION_LABELS: Record<VisionKind, string> = {
  protan: 'Protan Color Vision',
  deutan: 'Deutan Color Vision',
};

export const srgbToLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
export const linearToSrgb = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Simulate a dichromat's view of an sRGB color (components in [0, 1]). */
export function simulateVision(kind: VisionKind, rgb: ArrayLike<number>, out: number[] | Float32Array = [0, 0, 0]) {
  const m = VISION_MATRICES[kind];
  const r = srgbToLinear(rgb[0]),
    g = srgbToLinear(rgb[1]),
    b = srgbToLinear(rgb[2]);
  out[0] = linearToSrgb(clamp01(m[0] * r + m[1] * g + m[2] * b));
  out[1] = linearToSrgb(clamp01(m[3] * r + m[4] * g + m[5] * b));
  out[2] = linearToSrgb(clamp01(m[6] * r + m[7] * g + m[8] * b));
  return out;
}

/** Gray display value of one ink plate: paper white where the plate prints
 * nothing, black at full coverage (inks in [0, 1]). */
export function plateGray(cmyk: ArrayLike<number>, plate: Plate) {
  return 1 - clamp01(cmyk['cmyk'.indexOf(plate)]);
}

/** Compose a LUT with a per-color function applied to its outputs. */
export function mapLut(lut: Lut3D, f: (rgb: Float32Array, out: Float32Array) => void): Lut3D {
  const total = lut.size ** 3,
    data = new Float32Array(total * 4);
  const rgb = new Float32Array(3),
    out = new Float32Array(3);
  for (let i = 0; i < total; i++) {
    rgb[0] = lut.data[i * 4];
    rgb[1] = lut.data[i * 4 + 1];
    rgb[2] = lut.data[i * 4 + 2];
    f(rgb, out);
    data.set([out[0], out[1], out[2], 1], i * 4);
  }
  return { size: lut.size, outChannels: 3, data };
}
