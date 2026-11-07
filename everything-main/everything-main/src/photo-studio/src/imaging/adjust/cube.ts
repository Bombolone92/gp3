// Reader/writer for the open ".cube" LUT text format (the published "Cube
// LUT Specification" 1.0, 2013, plus the Resolve INPUT_RANGE keywords and the
// optional 1D shaper that precedes a 3D table). Data lines are R G B floats
// with red changing fastest.
export type CubeLut = {
  title: string;
  kind: '1d' | '3d';
  size: number;
  domainMin: [number, number, number];
  domainMax: [number, number, number];
  // 3 floats per entry; 3D: size^3 entries, r fastest then g then b.
  data: Float32Array;
  // Resolve-style 1D shaper applied before the 3D table.
  shaper?: CubeLut;
};

export class CubeParseError extends Error {
  constructor(message: string, readonly line?: number) {
    super(line ? `Line ${line}: ${message}` : message);
    this.name = 'CubeParseError';
  }
}

export function parseCubeLut(text: string): CubeLut {
  let title = '';
  let size1 = 0,
    size3 = 0;
  let min: [number, number, number] = [0, 0, 0],
    max: [number, number, number] = [1, 1, 1];
  let min1: [number, number, number] | null = null,
    max1: [number, number, number] | null = null;
  const values: number[] = [];
  const lines = text.split(/\r\n|\r|\n/);
  const triple = (parts: string[], ln: number): [number, number, number] => {
    const v = parts.slice(1, 4).map(Number);
    if (v.length !== 3 || !v.every(Number.isFinite)) throw new CubeParseError(`Expected three numbers after ${parts[0]}.`, ln);
    return v as [number, number, number];
  };
  for (let i = 0; i < lines.length; i++) {
    const ln = i + 1;
    const raw = lines[i].replace(/^﻿/, '');
    const hash = raw.indexOf('#');
    const line = (hash >= 0 && !/^\s*TITLE/.test(raw) ? raw.slice(0, hash) : raw).trim();
    if (!line) continue;
    const c = line.charCodeAt(0);
    // Data lines start with a digit, sign or decimal point.
    if ((c >= 48 && c <= 57) || c === 45 || c === 43 || c === 46) {
      const parts = line.split(/\s+/);
      if (parts.length < 3) throw new CubeParseError('Expected three values per data line.', ln);
      for (let k = 0; k < 3; k++) {
        const v = Number(parts[k]);
        if (!Number.isFinite(v)) throw new CubeParseError(`Invalid number "${parts[k]}".`, ln);
        values.push(v);
      }
      continue;
    }
    if (values.length) throw new CubeParseError('Keywords must come before the table data.', ln);
    const parts = line.split(/\s+/);
    const key = parts[0].toUpperCase();
    if (key === 'TITLE') {
      const m = /TITLE\s+"([^"]*)"/i.exec(line) ?? /TITLE\s+(.*)$/i.exec(line);
      title = m ? m[1].trim() : '';
    } else if (key === 'LUT_3D_SIZE' || key === 'LUT_1D_SIZE') {
      const n = Number(parts[1]);
      const limit = key === 'LUT_3D_SIZE' ? 256 : 65536;
      if (!Number.isInteger(n) || n < 2 || n > limit) throw new CubeParseError(`Invalid ${key} "${parts[1]}".`, ln);
      if (key === 'LUT_3D_SIZE') size3 = n;
      else size1 = n;
    } else if (key === 'DOMAIN_MIN') min = triple(parts, ln);
    else if (key === 'DOMAIN_MAX') max = triple(parts, ln);
    else if (key === 'LUT_1D_INPUT_RANGE' || key === 'LUT_3D_INPUT_RANGE') {
      const a = Number(parts[1]),
        b = Number(parts[2]);
      if (!Number.isFinite(a) || !Number.isFinite(b)) throw new CubeParseError(`Invalid ${key}.`, ln);
      if (key === 'LUT_1D_INPUT_RANGE') (min1 = [a, a, a]), (max1 = [b, b, b]);
      else (min = [a, a, a]), (max = [b, b, b]);
    }
    // Unknown keywords are ignored, as the specification recommends.
  }
  if (!size1 && !size3) throw new CubeParseError('Missing LUT_3D_SIZE or LUT_1D_SIZE.');
  for (let k = 0; k < 3; k++)
    if (!(max[k] > min[k])) throw new CubeParseError('DOMAIN_MAX must be greater than DOMAIN_MIN.');
  const n1 = size1 * 3,
    n3 = size3 * size3 * size3 * 3;
  if (values.length !== n1 + n3)
    throw new CubeParseError(`Expected ${(n1 + n3) / 3} table entries, found ${values.length / 3}.`);
  if (size3) {
    const lut: CubeLut = { title, kind: '3d', size: size3, domainMin: min, domainMax: max, data: Float32Array.from(values.slice(n1)) };
    if (size1)
      lut.shaper = { title, kind: '1d', size: size1, domainMin: min1 ?? [0, 0, 0], domainMax: max1 ?? [1, 1, 1], data: Float32Array.from(values.slice(0, n1)) };
    return lut;
  }
  return { title, kind: '1d', size: size1, domainMin: min1 ?? min, domainMax: max1 ?? max, data: Float32Array.from(values) };
}

const fmt = (v: number, decimals: number) => {
  const s = v.toFixed(decimals);
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '.0') : s;
};

export function serializeCubeLut(lut: CubeLut, decimals = 6): string {
  const out: string[] = [];
  if (lut.title) out.push(`TITLE "${lut.title.replace(/"/g, "'")}"`);
  const domain = (l: CubeLut, rangeKey: string) => {
    const uniform = l.domainMin.every((v) => v === l.domainMin[0]) && l.domainMax.every((v) => v === l.domainMax[0]);
    const isDefault = uniform && l.domainMin[0] === 0 && l.domainMax[0] === 1;
    if (isDefault) return;
    if (uniform && rangeKey === 'LUT_1D_INPUT_RANGE') out.push(`${rangeKey} ${fmt(l.domainMin[0], decimals)} ${fmt(l.domainMax[0], decimals)}`);
    else {
      out.push(`DOMAIN_MIN ${l.domainMin.map((v) => fmt(v, decimals)).join(' ')}`);
      out.push(`DOMAIN_MAX ${l.domainMax.map((v) => fmt(v, decimals)).join(' ')}`);
    }
  };
  if (lut.shaper) {
    out.push(`LUT_1D_SIZE ${lut.shaper.size}`);
    domain(lut.shaper, 'LUT_1D_INPUT_RANGE');
  }
  out.push(`${lut.kind === '3d' ? 'LUT_3D_SIZE' : 'LUT_1D_SIZE'} ${lut.size}`);
  domain(lut, lut.kind === '1d' ? 'LUT_1D_INPUT_RANGE' : 'DOMAIN');
  out.push('');
  const rows = (d: Float32Array) => {
    for (let i = 0; i < d.length; i += 3) out.push(`${fmt(d[i], decimals)} ${fmt(d[i + 1], decimals)} ${fmt(d[i + 2], decimals)}`);
  };
  if (lut.shaper) rows(lut.shaper.data);
  rows(lut.data);
  return out.join('\n') + '\n';
}

// Evaluates a LUT at an RGB input (any range; clamped to the domain).
export function sampleCubeLut(lut: CubeLut, r: number, g: number, b: number, out: Float64Array | number[]) {
  if (lut.shaper) {
    sampleCubeLut(lut.shaper, r, g, b, out);
    (r = out[0]), (g = out[1]), (b = out[2]);
  }
  const s = lut.size,
    d = lut.data,
    lo = lut.domainMin,
    hi = lut.domainMax;
  const pos = (v: number, k: number) => {
    const t = ((v - lo[k]) / (hi[k] - lo[k])) * (s - 1);
    return t <= 0 ? 0 : t >= s - 1 ? s - 1 : t;
  };
  const pr = pos(r, 0),
    pg = pos(g, 1),
    pb = pos(b, 2);
  if (lut.kind === '1d') {
    const ch = [pr, pg, pb];
    for (let k = 0; k < 3; k++) {
      const p = ch[k],
        i = Math.min(s - 2, p | 0),
        f = p - i;
      out[k] = d[i * 3 + k] + (d[(i + 1) * 3 + k] - d[i * 3 + k]) * f;
    }
    return out;
  }
  trilinear(d, s, 3, pr, pg, pb, out);
  return out;
}

// Trilinear interpolation in a grid with `stride` floats per entry, r fastest.
// pr/pg/pb are grid coordinates in [0, size - 1].
export function trilinear(
  d: Float32Array,
  s: number,
  stride: number,
  pr: number,
  pg: number,
  pb: number,
  out: Float64Array | number[],
) {
  const r0 = Math.min(s - 2, pr | 0),
    g0 = Math.min(s - 2, pg | 0),
    b0 = Math.min(s - 2, pb | 0);
  const fr = pr - r0,
    fg = pg - g0,
    fb = pb - b0;
  const sr = stride,
    sg = s * stride,
    sb = s * s * stride;
  const i000 = r0 * sr + g0 * sg + b0 * sb;
  for (let k = 0; k < 3; k++) {
    const i = i000 + k;
    const c00 = d[i] + (d[i + sr] - d[i]) * fr;
    const c10 = d[i + sg] + (d[i + sg + sr] - d[i + sg]) * fr;
    const c01 = d[i + sb] + (d[i + sb + sr] - d[i + sb]) * fr;
    const c11 = d[i + sb + sg] + (d[i + sb + sg + sr] - d[i + sb + sg]) * fr;
    const c0 = c00 + (c10 - c00) * fg,
      c1 = c01 + (c11 - c01) * fg;
    out[k] = c0 + (c1 - c0) * fb;
  }
}

// Bakes a color function sampled on a size^3 grid into a 3D LUT.
export function bakeCubeLut(
  fn: (r: number, g: number, b: number, out: Float64Array) => void,
  size = 33,
  title = '',
): CubeLut {
  const data = new Float32Array(size * size * size * 3);
  const o = new Float64Array(3);
  let i = 0;
  for (let b = 0; b < size; b++)
    for (let g = 0; g < size; g++)
      for (let r = 0; r < size; r++) {
        fn(r / (size - 1), g / (size - 1), b / (size - 1), o);
        data[i++] = o[0];
        data[i++] = o[1];
        data[i++] = o[2];
      }
  return { title, kind: '3d', size, domainMin: [0, 0, 0], domainMax: [1, 1, 1], data };
}
