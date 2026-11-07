// Reference math for the 27 layer blend modes. Separable and non-separable
// formulas follow W3C Compositing and Blending Level 1 (2015) where the spec
// defines them; the rest use the formulas commonly documented for raster
// editors. All channel values are straight (unassociated) and in [0, 1].
export type BlendMode =
  | 'normal'
  | 'dissolve'
  | 'darken'
  | 'multiply'
  | 'color-burn'
  | 'linear-burn'
  | 'darker-color'
  | 'lighten'
  | 'screen'
  | 'color-dodge'
  | 'linear-dodge'
  | 'lighter-color'
  | 'overlay'
  | 'soft-light'
  | 'hard-light'
  | 'vivid-light'
  | 'linear-light'
  | 'pin-light'
  | 'hard-mix'
  | 'difference'
  | 'exclusion'
  | 'subtract'
  | 'divide'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity';

// Menu order; `group` changes mark separators. The array index is the numeric
// mode id shared with the GLSL/WGSL snippets.
export const blendModes: { id: BlendMode; label: string; group: number }[] = [
  { id: 'normal', label: 'Normal', group: 0 },
  { id: 'dissolve', label: 'Dissolve', group: 0 },
  { id: 'darken', label: 'Darken', group: 1 },
  { id: 'multiply', label: 'Multiply', group: 1 },
  { id: 'color-burn', label: 'Color Burn', group: 1 },
  { id: 'linear-burn', label: 'Linear Burn', group: 1 },
  { id: 'darker-color', label: 'Darker Color', group: 1 },
  { id: 'lighten', label: 'Lighten', group: 2 },
  { id: 'screen', label: 'Screen', group: 2 },
  { id: 'color-dodge', label: 'Color Dodge', group: 2 },
  { id: 'linear-dodge', label: 'Linear Dodge (Add)', group: 2 },
  { id: 'lighter-color', label: 'Lighter Color', group: 2 },
  { id: 'overlay', label: 'Overlay', group: 3 },
  { id: 'soft-light', label: 'Soft Light', group: 3 },
  { id: 'hard-light', label: 'Hard Light', group: 3 },
  { id: 'vivid-light', label: 'Vivid Light', group: 3 },
  { id: 'linear-light', label: 'Linear Light', group: 3 },
  { id: 'pin-light', label: 'Pin Light', group: 3 },
  { id: 'hard-mix', label: 'Hard Mix', group: 3 },
  { id: 'difference', label: 'Difference', group: 4 },
  { id: 'exclusion', label: 'Exclusion', group: 4 },
  { id: 'subtract', label: 'Subtract', group: 4 },
  { id: 'divide', label: 'Divide', group: 4 },
  { id: 'hue', label: 'Hue', group: 5 },
  { id: 'saturation', label: 'Saturation', group: 5 },
  { id: 'color', label: 'Color', group: 5 },
  { id: 'luminosity', label: 'Luminosity', group: 5 },
];
const indexById = new Map(blendModes.map((m, i) => [m.id, i]));
export function blendModeIndex(mode: BlendMode | number): number {
  if (typeof mode === 'number') return mode;
  const i = indexById.get(mode);
  if (i === undefined) throw new Error(`Unknown blend mode: ${mode}`);
  return i;
}
export function isBlendMode(value: unknown): value is BlendMode {
  return typeof value === 'string' && indexById.has(value as BlendMode);
}
// Index constants used by the hot paths below.
export const M = {
  normal: 0, dissolve: 1, darken: 2, multiply: 3, colorBurn: 4, linearBurn: 5, darkerColor: 6,
  lighten: 7, screen: 8, colorDodge: 9, linearDodge: 10, lighterColor: 11, overlay: 12,
  softLight: 13, hardLight: 14, vividLight: 15, linearLight: 16, pinLight: 17, hardMix: 18,
  difference: 19, exclusion: 20, subtract: 21, divide: 22, hue: 23, saturation: 24, color: 25,
  luminosity: 26,
} as const;
export function isSeparable(mode: BlendMode | number): boolean {
  const m = blendModeIndex(mode);
  return m !== M.darkerColor && m !== M.lighterColor && m < M.hue;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export function colorBurn(b: number, s: number) {
  if (b >= 1) return 1;
  if (s <= 0) return 0;
  return 1 - Math.min(1, (1 - b) / s);
}
export function colorDodge(b: number, s: number) {
  if (b <= 0) return 0;
  if (s >= 1) return 1;
  return Math.min(1, b / (1 - s));
}
const screen = (b: number, s: number) => b + s - b * s;
function hardLight(b: number, s: number) {
  return s <= 0.5 ? b * 2 * s : screen(b, 2 * s - 1);
}
function softLight(b: number, s: number) {
  if (s <= 0.5) return b - (1 - 2 * s) * b * (1 - b);
  const d = b <= 0.25 ? ((16 * b - 12) * b + 4) * b : Math.sqrt(b);
  return b + (2 * s - 1) * (d - b);
}

// B(Cb, Cs) for one channel of a separable mode (index form).
export function blendChannel(mode: number, b: number, s: number): number {
  switch (mode) {
    case M.darken: return Math.min(b, s);
    case M.multiply: return b * s;
    case M.colorBurn: return colorBurn(b, s);
    case M.linearBurn: return Math.max(0, b + s - 1);
    case M.lighten: return Math.max(b, s);
    case M.screen: return screen(b, s);
    case M.colorDodge: return colorDodge(b, s);
    case M.linearDodge: return Math.min(1, b + s);
    case M.overlay: return hardLight(s, b);
    case M.softLight: return softLight(b, s);
    case M.hardLight: return hardLight(b, s);
    case M.vividLight: return s <= 0.5 ? colorBurn(b, 2 * s) : colorDodge(b, 2 * s - 1);
    case M.linearLight: return clamp01(b + 2 * s - 1);
    case M.pinLight: return s <= 0.5 ? Math.min(b, 2 * s) : Math.max(b, 2 * s - 1);
    // Thresholding the sum is the usual statement of Hard Mix (it equals
    // thresholding Vivid Light at one half for all but exact ties).
    case M.hardMix: return b + s >= 1 ? 1 : 0;
    case M.difference: return Math.abs(b - s);
    case M.exclusion: return b + s - 2 * b * s;
    case M.subtract: return Math.max(0, b - s);
    case M.divide: return s <= 0 ? (b <= 0 ? 0 : 1) : Math.min(1, b / s);
    default: return s;
  }
}

// W3C non-separable helpers (Rec. 601 luma weights, as the spec defines).
export const lum = (r: number, g: number, b: number) => 0.3 * r + 0.59 * g + 0.11 * b;
export const sat = (r: number, g: number, b: number) =>
  Math.max(r, g, b) - Math.min(r, g, b);
function clipColor(c: number[]) {
  const l = lum(c[0], c[1], c[2]);
  const n = Math.min(c[0], c[1], c[2]);
  const x = Math.max(c[0], c[1], c[2]);
  if (n < 0 && l > n) for (let i = 0; i < 3; i++) c[i] = l + ((c[i] - l) * l) / (l - n);
  if (x > 1 && x > l) for (let i = 0; i < 3; i++) c[i] = l + ((c[i] - l) * (1 - l)) / (x - l);
  return c;
}
function setLum(c: number[], l: number) {
  const d = l - lum(c[0], c[1], c[2]);
  c[0] += d;
  c[1] += d;
  c[2] += d;
  return clipColor(c);
}
function setSat(c: number[], s: number) {
  const mx = Math.max(c[0], c[1], c[2]);
  const mn = Math.min(c[0], c[1], c[2]);
  for (let i = 0; i < 3; i++) c[i] = mx > mn ? ((c[i] - mn) * s) / (mx - mn) : 0;
  return c;
}

// B(Cb, Cs) for any mode; writes into `out` (length >= 3) and returns it.
export function blendColor(
  mode: BlendMode | number,
  b: ArrayLike<number>,
  s: ArrayLike<number>,
  out: number[] = [0, 0, 0],
): number[] {
  const m = blendModeIndex(mode);
  const br = b[0], bg = b[1], bb = b[2], sr = s[0], sg = s[1], sb = s[2];
  if (isSeparable(m)) {
    out[0] = blendChannel(m, br, sr);
    out[1] = blendChannel(m, bg, sg);
    out[2] = blendChannel(m, bb, sb);
    return out;
  }
  switch (m) {
    case M.darkerColor:
    case M.lighterColor: {
      // Whole-color pick by luma; ties keep the source.
      const lb = lum(br, bg, bb), ls = lum(sr, sg, sb);
      const pickBack = m === M.darkerColor ? lb < ls : lb > ls;
      out[0] = pickBack ? br : sr;
      out[1] = pickBack ? bg : sg;
      out[2] = pickBack ? bb : sb;
      return out;
    }
    case M.hue:
      out[0] = sr; out[1] = sg; out[2] = sb;
      return setLum(setSat(out, sat(br, bg, bb)), lum(br, bg, bb));
    case M.saturation:
      out[0] = br; out[1] = bg; out[2] = bb;
      return setLum(setSat(out, sat(sr, sg, sb)), lum(br, bg, bb));
    case M.color:
      out[0] = sr; out[1] = sg; out[2] = sb;
      return setLum(out, lum(br, bg, bb));
    default:
      out[0] = br; out[1] = bg; out[2] = bb;
      return setLum(out, lum(sr, sg, sb));
  }
}

// Source-over with blending (W3C 5.8 / 10.1), straight in and out:
//   Cs' = (1 - ab) Cs + ab B(Cb, Cs)
//   ao  = as + ab (1 - as)
//   Co  = (as Cs' + (1 - as) ab Cb) / ao
// `rand` in [0, 1) drives Dissolve, which turns partial coverage into a
// per-pixel all-or-nothing choice instead of a blend.
export function blendPixel(
  mode: BlendMode | number,
  backdrop: ArrayLike<number>,
  source: ArrayLike<number>,
  opacity = 1,
  rand = 0.5,
): [number, number, number, number] {
  const m = blendModeIndex(mode);
  const ab = clamp01(backdrop[3]);
  let as = clamp01(source[3] * opacity);
  if (m === M.dissolve) as = rand < as ? 1 : 0;
  const ao = as + ab * (1 - as);
  if (ao <= 0) return [0, 0, 0, 0];
  const bl = blendColor(m, backdrop, source);
  const out: [number, number, number, number] = [0, 0, 0, ao];
  for (let i = 0; i < 3; i++) {
    const cs = (1 - ab) * source[i] + ab * bl[i];
    out[i] = (as * cs + (1 - as) * ab * backdrop[i]) / ao;
  }
  return out;
}

// Deterministic per-pixel noise in [0, 1) for Dissolve and effect noise.
export function hash01(x: number, y: number, seed = 0): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
