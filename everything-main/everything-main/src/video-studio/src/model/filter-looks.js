/**
 * Filter looks beyond the Color tab values: a filter may carry an HSL table
 * and curves (see model/looks-extra.js). They join the clip's own grade in
 * the packed form the color shader reads (model/color.js packGrade), scaled
 * by the filter intensity. The clip's own curves win over the filter's.
 */
import { packGrade } from './color.js';

const packed = new Map();

function lookOf(f) {
  if (!packed.has(f.id)) packed.set(f.id, packGrade({ hsl: f.hsl || null, curves: f.curves || null }));
  return packed.get(f.id);
}

/** ext (packed grade or null) with filter f's HSL and curves added at amount amt (0..1). */
export function withFilterLook(ext, f, amt) {
  if (!(amt > 0)) return ext;
  const look = lookOf(f);
  if (!look) return ext;
  const out = ext ? { ...ext } : { hsl: null, wheels: null, curves: null, curvesKey: '', lut: null };
  if (look.hsl) {
    const arr = new Float32Array(24);
    for (let i = 0; i < 24; i++) arr[i] = (ext?.hsl?.[i] || 0) + look.hsl[i] * amt;
    out.hsl = arr;
  }
  if (look.curves && !out.curves) {
    const k = Math.round(amt * 100) / 100;
    const curves = {};
    for (const [ch, pts] of Object.entries(look.curves)) curves[ch] = pts.map(([x, y]) => [x, x + (y - x) * k]);
    out.curves = curves;
    out.curvesKey = `filter:${f.id}:${k}`;
  }
  return out;
}
