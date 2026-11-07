// Exporting the combined effect of an adjustment stack as a 3D color lookup
// table: .cube (the open "Cube LUT Specification" 1.0), .3dl (integer mesh
// text tables: a 10-bit input mesh line, then 12-bit output rows with blue
// changing fastest) and .csp (text tables with per-channel 1D prelut
// sections, then the 3D cube with red changing fastest).
import { blendColor, type BlendMode } from '../blend/modes';
import { bakeCubeLut, serializeCubeLut } from './cube';
import { planFor, type Plan } from './kinds';
import type { Fn1 } from './curves';
import type { Adjustment } from './model';

export type LutFormat = 'cube' | '3dl' | 'csp';
export const LUT_FORMATS: { id: LutFormat; label: string; sizes: number[] }[] = [
  { id: 'cube', label: 'CUBE (.cube)', sizes: [17, 32, 33, 64, 65] },
  { id: '3dl', label: '3DL (.3dl)', sizes: [17, 33, 65] },
  { id: 'csp', label: 'CSP (.csp)', sizes: [17, 32, 33, 64, 65] },
];
// One adjustment layer as seen by the table: its color function mixed over
// the colors below with its opacity and blend mode.
export type LutStep = { adjustment: Adjustment; opacity: number; blend?: BlendMode };
// Color function on floats in [0, 1].
export type ColorFn = (r: number, g: number, b: number, out: Float64Array) => void;

const c01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const compose = (a: Fn1 | undefined, b: Fn1 | undefined) => (x: number) => {
  let v = a ? c01(a(x)) : x;
  if (b) v = c01(b(v));
  return v;
};

function planFn(plan: Plan): (v: Float64Array) => void {
  const c = plan.curves;
  const r = compose(c?.rgb, c?.r), g = compose(c?.rgb, c?.g), b = compose(c?.rgb, c?.b);
  return (v) => {
    v[0] = r(v[0]);
    v[1] = g(v[1]);
    v[2] = b(v[2]);
    if (plan.pixel) plan.pixel(v, v, 1);
    v[0] = c01(v[0]);
    v[1] = c01(v[1]);
    v[2] = c01(v[2]);
  };
}

/** The stack (bottom first) as one color function. */
export function stackColorFn(steps: LutStep[]): ColorFn {
  const stages = steps.map((s) => ({ fn: planFn(planFor(s.adjustment)), opacity: c01(s.opacity), blend: s.blend ?? 'normal' }));
  const adjusted = new Float64Array(3), blended = [0, 0, 0];
  return (r, g, b, out) => {
    out[0] = r;
    out[1] = g;
    out[2] = b;
    for (const s of stages) {
      adjusted[0] = out[0];
      adjusted[1] = out[1];
      adjusted[2] = out[2];
      s.fn(adjusted);
      const top = s.blend === 'normal' ? adjusted : blendColor(s.blend, out, adjusted, blended);
      for (let k = 0; k < 3; k++) out[k] = out[k] + (c01(top[k]) - out[k]) * s.opacity;
    }
  };
}

const num = (v: number) => {
  const s = c01(v).toFixed(6);
  return s.replace(/0+$/, '').replace(/\.$/, '.0');
};

/** 10-bit input mesh positions of a .3dl table with `size` points. */
export function meshPoints3dl(size: number): number[] {
  return Array.from({ length: size }, (_, i) => Math.round((i * 1023) / (size - 1)));
}

export function write3dl(fn: ColorFn, size: number): string {
  if (!Number.isInteger(size) || size < 2 || size > 65) throw new Error('A .3dl table has 2 to 65 points per axis.');
  const mesh = meshPoints3dl(size);
  const out: string[] = [mesh.join(' ')];
  const o = new Float64Array(3);
  const q = (v: number) => Math.round(c01(v) * 4095);
  for (let r = 0; r < size; r++)
    for (let g = 0; g < size; g++)
      for (let b = 0; b < size; b++) {
        fn(mesh[r] / 1023, mesh[g] / 1023, mesh[b] / 1023, o);
        out.push(`${q(o[0])} ${q(o[1])} ${q(o[2])}`);
      }
  return out.join('\n') + '\n';
}

export function writeCsp(fn: ColorFn, size: number, title = ''): string {
  if (!Number.isInteger(size) || size < 2 || size > 256) throw new Error('A .csp table has 2 to 256 points per axis.');
  const out = ['CSPLUTV100', '3D', ''];
  const meta = title.replace(/[\r\n]+/g, ' ').trim();
  if (meta) out.push('BEGIN METADATA', meta, 'END METADATA', '');
  for (let k = 0; k < 3; k++) out.push('2', '0.0 1.0', '0.0 1.0');
  out.push('', `${size} ${size} ${size}`);
  const o = new Float64Array(3);
  for (let b = 0; b < size; b++)
    for (let g = 0; g < size; g++)
      for (let r = 0; r < size; r++) {
        fn(r / (size - 1), g / (size - 1), b / (size - 1), o);
        out.push(`${num(o[0])} ${num(o[1])} ${num(o[2])}`);
      }
  return out.join('\n') + '\n';
}

/** Writes the stack in a chosen format. */
export function writeLut(format: LutFormat, fn: ColorFn, size: number, title = ''): string {
  if (format === '3dl') return write3dl(fn, size);
  if (format === 'csp') return writeCsp(fn, size, title);
  if (!Number.isInteger(size) || size < 2 || size > 256) throw new Error('A .cube table has 2 to 256 points per axis.');
  return serializeCubeLut(bakeCubeLut(fn, size, title.replace(/[\r\n]+/g, ' ').trim()));
}
