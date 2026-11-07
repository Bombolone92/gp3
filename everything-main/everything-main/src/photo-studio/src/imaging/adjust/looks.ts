// Built-in Color Lookup looks, designed here as small procedural color
// functions (no third-party LUT data). They are evaluated exactly on the CPU
// and baked into a 3D LUT for the GPU path.
import { gain } from './curves';
import { luma } from './color-math';

export type LookFn = (r: number, g: number, b: number, out: Float64Array) => void;
export type BuiltinLookId = 'warm-film' | 'teal-shadows' | 'faded' | 'high-key-bw' | 'cool-night' | 'cross-process';

const c01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

function saturate(r: number, g: number, b: number, k: number, out: Float64Array) {
  const l = luma(r, g, b);
  out[0] = l + (r - l) * k;
  out[1] = l + (g - l) * k;
  out[2] = l + (b - l) * k;
}

const warmFilm: LookFn = (r, g, b, out) => {
  r = gain(r, 0.58);
  g = gain(g, 0.57);
  b = gain(b, 0.55);
  const l = luma(r, g, b);
  // Warm highlights, slightly green-free shadows, softened saturation.
  r += 0.05 * l;
  b -= 0.07 * l;
  g += 0.01 * (1 - l);
  saturate(r, g, b, 0.88, out);
  for (let k = 0; k < 3; k++) out[k] = c01(0.035 + 0.94 * c01(out[k]));
};

const tealShadows: LookFn = (r, g, b, out) => {
  r = gain(r, 0.56);
  g = gain(g, 0.56);
  b = gain(b, 0.56);
  const l = luma(r, g, b),
    ws = (1 - l) * (1 - l),
    wh = l * l;
  r += -0.08 * ws + 0.07 * wh;
  g += 0.02 * ws + 0.02 * wh;
  b += 0.07 * ws - 0.07 * wh;
  // Restore most of the original brightness so the grade reads as color only.
  const d = (l - luma(r, g, b)) * 0.8;
  out[0] = c01(r + d);
  out[1] = c01(g + d);
  out[2] = c01(b + d);
};

const faded: LookFn = (r, g, b, out) => {
  saturate(r, g, b, 0.72, out);
  const l = luma(out[0], out[1], out[2]);
  const warm = 0.025 * (1 - l);
  out[0] = c01(0.1 + 0.82 * c01(out[0]) + warm);
  out[1] = c01(0.1 + 0.82 * c01(out[1]) + warm * 0.4);
  out[2] = c01(0.1 + 0.82 * c01(out[2]) - warm * 0.2);
};

const highKeyBw: LookFn = (r, g, b, out) => {
  // Red-leaning panchromatic mix brightens skin, then lift and soften.
  let v = c01(0.34 * r + 0.56 * g + 0.1 * b);
  v = Math.pow(v, 0.7);
  v = gain(v, 0.44);
  v = c01(0.04 + 0.97 * v);
  out[0] = out[1] = out[2] = v;
};

const coolNight: LookFn = (r, g, b, out) => {
  saturate(Math.pow(r, 1.15), Math.pow(g, 1.12), Math.pow(b, 1.05), 0.7, out);
  const l = luma(out[0], out[1], out[2]),
    ws = 1 - l;
  out[0] = c01(out[0] - 0.03 * ws);
  out[1] = c01(out[1] + 0.005);
  out[2] = c01(out[2] + 0.07 * ws + 0.02);
};

const crossProcess: LookFn = (r, g, b, out) => {
  out[0] = c01(gain(r, 0.64) * 1.02);
  out[1] = c01(gain(g, 0.6) * 0.97 + 0.02);
  out[2] = c01(0.13 + 0.72 * b);
  // Yellow-green highlights.
  const l = luma(out[0], out[1], out[2]);
  out[2] = c01(out[2] - 0.08 * l * l);
};

export const BUILTIN_LOOKS: { id: BuiltinLookId; label: string; fn: LookFn }[] = [
  { id: 'warm-film', label: 'Warm Film', fn: warmFilm },
  { id: 'teal-shadows', label: 'Teal Shadows', fn: tealShadows },
  { id: 'faded', label: 'Faded', fn: faded },
  { id: 'high-key-bw', label: 'High Key B&W', fn: highKeyBw },
  { id: 'cool-night', label: 'Cool Night', fn: coolNight },
  { id: 'cross-process', label: 'Cross Process', fn: crossProcess },
];

export function builtinLook(id: string): LookFn | undefined {
  return BUILTIN_LOOKS.find((l) => l.id === id)?.fn;
}
