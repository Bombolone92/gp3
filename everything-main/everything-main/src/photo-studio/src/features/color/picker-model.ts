// Geometry of the color picker: which component the vertical strip controls
// and how the square field maps to colors for each choice. Pure functions.
import { hsbToRgb, rgbToHsb } from '../../color/color-management';

export type Axis = 'h' | 's' | 'v' | 'r' | 'g' | 'b' | 'L' | 'A' | 'B';
export const AXES: Axis[] = ['h', 's', 'v', 'L', 'A', 'B', 'r', 'g', 'b'];
export type RGB = [number, number, number];
export type Lab = [number, number, number];
export type PickerState = { hsb: { h: number; s: number; b: number }; rgb: RGB; lab: Lab };
export type LabConverter = { toRgb(lab: ArrayLike<number>, count: number, out: Float32Array): void; toLab(rgb: RGB): Lab };

// Ranges of each component in its natural unit.
const range: Record<Axis, [number, number]> = {
  h: [0, 360], s: [0, 100], v: [0, 100], r: [0, 255], g: [0, 255], b: [0, 255], L: [0, 100], A: [-128, 127], B: [-128, 127],
};
// Field axes (x, y) for each strip component.
export const fieldAxes: Record<Axis, [Axis, Axis]> = {
  h: ['s', 'v'], s: ['h', 'v'], v: ['h', 's'], r: ['b', 'g'], g: ['b', 'r'], b: ['r', 'g'], L: ['A', 'B'], A: ['B', 'L'], B: ['A', 'L'],
};
const norm = (a: Axis, v: number) => (v - range[a][0]) / (range[a][1] - range[a][0]);
const denorm = (a: Axis, t: number) => range[a][0] + Math.max(0, Math.min(1, t)) * (range[a][1] - range[a][0]);

export function component(state: PickerState, a: Axis): number {
  switch (a) {
    case 'h': return state.hsb.h;
    case 's': return state.hsb.s;
    case 'v': return state.hsb.b;
    case 'r': return state.rgb[0];
    case 'g': return state.rgb[1];
    case 'b': return state.rgb[2];
    case 'L': return state.lab[0];
    case 'A': return state.lab[1];
    case 'B': return state.lab[2];
  }
}
const family = (a: Axis) => (a === 'h' || a === 's' || a === 'v' ? 'hsb' : a === 'r' || a === 'g' || a === 'b' ? 'rgb' : 'lab');

/** Normalized positions (0-1) of the state on the strip and field; y = 0 is the top. */
export function positions(state: PickerState, strip: Axis) {
  const [ax, ay] = fieldAxes[strip];
  return { z: norm(strip, component(state, strip)), x: norm(ax, component(state, ax)), y: 1 - norm(ay, component(state, ay)) };
}

/** Color at normalized strip/field coordinates. Lab results are clipped
 * into the document gamut by the converter. */
export function stateAt(strip: Axis, z: number, x: number, y: number, prev: PickerState, lab: LabConverter): PickerState {
  const [ax, ay] = fieldAxes[strip];
  const values: Partial<Record<Axis, number>> = { [strip]: denorm(strip, z), [ax]: denorm(ax, x), [ay]: denorm(ay, 1 - y) };
  const f = family(strip);
  if (f === 'hsb') {
    const hsb = { h: values.h ?? prev.hsb.h, s: values.s ?? prev.hsb.s, b: values.v ?? prev.hsb.b };
    if (hsb.h >= 360) hsb.h = 0;
    const rgb = hsbToRgb(hsb.h, hsb.s, hsb.b).map((c) => Math.round(c)) as RGB;
    return { hsb, rgb, lab: lab.toLab(rgb) };
  }
  if (f === 'rgb') {
    const rgb = [values.r ?? prev.rgb[0], values.g ?? prev.rgb[1], values.b ?? prev.rgb[2]].map((c) => Math.round(c)) as RGB;
    return fromRgb(rgb, prev, lab);
  }
  const l: Lab = [values.L ?? prev.lab[0], values.A ?? prev.lab[1], values.B ?? prev.lab[2]];
  const out = new Float32Array(3);
  lab.toRgb(l, 1, out);
  const rgb = [...out].map((c) => Math.round(Math.max(0, Math.min(1, c)) * 255)) as RGB;
  return { hsb: keepHue(rgbToHsb(rgb[0], rgb[1], rgb[2]), prev), rgb, lab: l };
}

/** State for a new RGB value; the hue survives grays and black. */
export function fromRgb(rgb: RGB, prev: PickerState | undefined, lab: LabConverter): PickerState {
  return { hsb: keepHue(rgbToHsb(rgb[0], rgb[1], rgb[2]), prev), rgb, lab: lab.toLab(rgb) };
}
function keepHue(hsb: { h: number; s: number; b: number }, prev?: PickerState) {
  if (prev && (hsb.s === 0 || hsb.b === 0)) return { ...hsb, h: prev.hsb.h, s: hsb.b === 0 ? prev.hsb.s : hsb.s };
  return hsb;
}

/** RGBA pixels of the field (w x h) at strip position z. */
export function renderField(strip: Axis, z: number, w: number, h: number, prev: PickerState, lab: LabConverter): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4);
  const [ax, ay] = fieldAxes[strip];
  const f = family(strip);
  if (f === 'lab') {
    const vals = new Float32Array(w * h * 3);
    for (let y = 0, i = 0; y < h; y++)
      for (let x = 0; x < w; x++, i += 3) {
        const v: Partial<Record<Axis, number>> = { [strip]: denorm(strip, z), [ax]: denorm(ax, x / (w - 1)), [ay]: denorm(ay, 1 - y / (h - 1)) };
        vals[i] = v.L!;
        vals[i + 1] = v.A!;
        vals[i + 2] = v.B!;
      }
    const rgb = new Float32Array(w * h * 3);
    lab.toRgb(vals, w * h, rgb);
    for (let p = 0; p < w * h; p++) {
      for (let c = 0; c < 3; c++) out[p * 4 + c] = rgb[p * 3 + c] * 255;
      out[p * 4 + 3] = 255;
    }
    return out;
  }
  for (let y = 0, p = 0; y < h; y++)
    for (let x = 0; x < w; x++, p += 4) {
      const v: Partial<Record<Axis, number>> = { [strip]: denorm(strip, z), [ax]: denorm(ax, x / (w - 1)), [ay]: denorm(ay, 1 - y / (h - 1)) };
      const rgb = f === 'hsb' ? hsbToRgb(v.h ?? prev.hsb.h, v.s ?? prev.hsb.s, v.v ?? prev.hsb.b) : [v.r!, v.g!, v.b!];
      out[p] = rgb[0];
      out[p + 1] = rgb[1];
      out[p + 2] = rgb[2];
      out[p + 3] = 255;
    }
  return out;
}

/** RGBA pixels of the vertical strip (1 x h, top = maximum). The hue strip
 * shows pure hues; the others vary their component around the current color. */
export function renderStrip(strip: Axis, h: number, state: PickerState, lab: LabConverter): Uint8ClampedArray {
  const out = new Uint8ClampedArray(h * 4);
  const f = family(strip);
  const labs = new Float32Array(h * 3);
  for (let y = 0; y < h; y++) {
    const t = 1 - y / (h - 1);
    const v = denorm(strip, t);
    let rgb: number[] = [0, 0, 0];
    if (strip === 'h') rgb = hsbToRgb(v >= 360 ? 0 : v, 100, 100);
    else if (f === 'hsb') rgb = hsbToRgb(state.hsb.h, strip === 's' ? v : state.hsb.s, strip === 'v' ? v : state.hsb.b);
    else if (f === 'rgb') rgb = state.rgb.map((c, i) => (i === 'rgb'.indexOf(strip) ? v : c));
    else {
      const l = [...state.lab];
      l['LAB'.indexOf(strip)] = v;
      labs.set(l, y * 3);
      continue;
    }
    out.set([rgb[0], rgb[1], rgb[2], 255], y * 4);
  }
  if (f === 'lab') {
    const rgb = new Float32Array(h * 3);
    lab.toRgb(labs, h, rgb);
    for (let y = 0; y < h; y++) out.set([rgb[y * 3] * 255, rgb[y * 3 + 1] * 255, rgb[y * 3 + 2] * 255, 255], y * 4);
  }
  return out;
}

export const webSafe = (rgb: RGB): RGB => rgb.map((c) => Math.round(c / 51) * 51) as RGB;
