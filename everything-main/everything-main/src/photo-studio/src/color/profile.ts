// ICC v2/v4 RGB matrix/TRC profiles. Colorant columns already map to the D50
// PCS; chad must not be applied to them a second time. Relative colorimetry is
// used for the sRGB workspace display. LUT/multi-process profiles need a CMM.
// https://www.color.org/specification/ICC.1-2022-05.pdf
export type Curve =
  | { kind: 'parametric'; type: number; parameters: number[] }
  | { kind: 'table'; values: number[] }
  | { kind: 'srgb' };
export type RgbProfile = { matrix: number[]; curves: [Curve, Curve, Curve] };
export class ProfileError extends Error {}

export function multiplyMatrix(a: number[], b: number[]): number[] {
  return Array.from({ length: 9 }, (_, i) => {
    const row = Math.floor(i / 3),
      column = i % 3;
    return a[row * 3] * b[column] + a[row * 3 + 1] * b[column + 3] + a[row * 3 + 2] * b[column + 6];
  });
}
export function inverseMatrix(m: number[]): number[] {
  const [a, b, c, d, e, f, g, h, i] = m;
  const adj = [
    e * i - f * h,
    c * h - b * i,
    b * f - c * e,
    f * g - d * i,
    a * i - c * g,
    c * d - a * f,
    d * h - e * g,
    b * g - a * h,
    a * e - b * d,
  ];
  const determinant = a * adj[0] + b * adj[3] + c * adj[6];
  if (!Number.isFinite(determinant) || determinant === 0)
    throw new ProfileError('Singular ICC RGB colorant matrix.');
  const result = adj.map((n) => n / determinant);
  if (!result.every(Number.isFinite)) throw new ProfileError('Invalid ICC RGB colorant matrix.');
  return result;
}

// Bradford cone response and standard sRGB primaries (D65). Adapt the output
// primaries to ICC's specified PCS white, rather than a profile's device wtpt.
const bradford = [0.8951, 0.2664, -0.1614, -0.7502, 1.7135, 0.0367, 0.0389, -0.0685, 1.0296];
const vector = (m: number[], v: number[]) =>
  [0, 1, 2].map((r) => m[r * 3] * v[0] + m[r * 3 + 1] * v[1] + m[r * 3 + 2] * v[2]);
const d65 = [3127 / 3290, 1, 3583 / 3290];
const d50 = [0.9642, 1, 0.8249];
const sourceWhite = vector(bradford, d65),
  targetWhite = vector(bradford, d50);
const scale = sourceWhite.map((n, i) => targetWhite[i] / n);
const adaptation = multiplyMatrix(
  inverseMatrix(bradford),
  bradford.map((n, i) => n * scale[Math.floor(i / 3)]),
);
// IEC sRGB primaries expressed as exact fractions in CSS Color 4's conversion
// reference: https://www.w3.org/TR/css-color-4/#color-conversion-code
export const srgbProfile: RgbProfile = {
  matrix: multiplyMatrix(adaptation, [
    506752 / 1228815,
    87881 / 245763,
    12673 / 70218,
    87098 / 409605,
    175762 / 245763,
    12673 / 175545,
    7918 / 409605,
    87881 / 737289,
    1001167 / 1053270,
  ]),
  curves: [{ kind: 'srgb' }, { kind: 'srgb' }, { kind: 'srgb' }],
};

const linearCurve = (): Curve => ({ kind: 'parametric', type: 0, parameters: [1] });
export const linearSrgbProfile: RgbProfile = {
  matrix: srgbProfile.matrix,
  curves: [linearCurve(), linearCurve(), linearCurve()],
};

export function readRgbProfile(bytes: Uint8Array): RgbProfile {
  const fail = (message: string): never => {
    throw new ProfileError(message);
  };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const signature = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
  if (bytes.length < 132 || signature(36) !== 'acsp') fail('Invalid ICC profile header.');
  const size = view.getUint32(0),
    major = bytes[8];
  if (size < 132 || size > bytes.length || (major !== 2 && major !== 4))
    fail('Invalid or unsupported ICC profile version/length.');
  if (
    signature(16) !== 'RGB ' ||
    signature(20) !== 'XYZ ' ||
    !['scnr', 'mntr', 'spac'].includes(signature(12))
  )
    fail('Color rendering requires an RGB matrix/TRC ICC profile.');
  const count = view.getUint32(128),
    end = 132 + count * 12;
  if (end > size) fail('Invalid ICC tag table.');
  const tags = new Map<string, DataView>();
  const ranges: { offset: number; length: number }[] = [];
  for (let i = 0; i < count; i++) {
    const at = 132 + i * 12,
      name = signature(at);
    const offset = view.getUint32(at + 4),
      length = view.getUint32(at + 8);
    if (tags.has(name) || offset < end || offset % 4 !== 0 || length < 8 || offset + length > size)
      fail('Invalid ICC tag boundary.');
    ranges.push({ offset, length });
    tags.set(name, new DataView(bytes.buffer, bytes.byteOffset + offset, length));
  }
  ranges.sort((a, b) => a.offset - b.offset || a.length - b.length);
  for (let i = 1; i < ranges.length; i++) {
    const a = ranges[i - 1],
      b = ranges[i];
    if (b.offset < a.offset + a.length && !(a.offset === b.offset && a.length === b.length))
      fail('Overlapping ICC tag payloads.');
  }
  // ICC precedence requires these transforms before the matrix. Never silently
  // discard a selected LUT in a hybrid profile in favor of its colorant tags.
  if (['A2B0', 'A2B1', 'D2B1'].some((name) => tags.has(name)))
    fail('ICC LUT and multi-process color transforms are not yet supported.');
  const tag = (name: string) => tags.get(name) ?? fail(`Missing ICC ${name} tag.`);
  const type = (t: DataView) =>
    String.fromCharCode(t.getUint8(0), t.getUint8(1), t.getUint8(2), t.getUint8(3));
  const xyz = (name: string) => {
    const t = tag(name);
    if (t.byteLength !== 20 || type(t) !== 'XYZ ') fail(`Invalid ICC ${name} colorant.`);
    return [8, 12, 16].map((at) => t.getInt32(at) / 65536);
  };
  const columns = ['rXYZ', 'gXYZ', 'bXYZ'].map(xyz);
  const matrix = Array.from({ length: 9 }, (_, i) => columns[i % 3][Math.floor(i / 3)]);
  inverseMatrix(matrix);
  const parsedCurves = new Map<string, Curve>();
  const parseCurve = (t: DataView, name: string): Curve => {
    const kind = type(t);
    if (t.byteLength < 12) fail(`Truncated ICC ${name} curve.`);
    if (kind === 'curv') {
      const length = t.getUint32(8);
      if (12 + length * 2 > t.byteLength) fail(`Truncated ICC ${name} curve samples.`);
      if (!length) return linearCurve();
      if (length === 1) {
        const gamma = t.getUint16(12) / 256;
        if (gamma <= 0) fail('Invalid ICC curve gamma.');
        return { kind: 'parametric', type: 0, parameters: [gamma] };
      }
      const values = Array.from({ length }, (_, i) => t.getUint16(12 + i * 2) / 65535);
      if (values.some((n, i) => i > 0 && n < values[i - 1])) fail('Non-monotonic ICC tone curve.');
      return { kind: 'table', values };
    }
    if (kind !== 'para') fail(`Unsupported ICC ${name} curve type.`);
    const fn = t.getUint16(8),
      length = [1, 3, 4, 5, 7][fn];
    if (!length || 12 + length * 4 > t.byteLength) fail('Invalid ICC parametric curve.');
    const p = Array.from({ length }, (_, i) => t.getInt32(12 + i * 4) / 65536);
    if (p[0] <= 0 || (fn > 0 && p[1] <= 0) || (fn >= 3 && (p[3] < 0 || p[4] < -p[2] / p[1])))
      fail('Undefined ICC parametric curve.');
    return { kind: 'parametric', type: fn, parameters: p };
  };
  const curve = (name: string) => {
    const t = tag(name),
      key = `${t.byteOffset}:${t.byteLength}`;
    let value = parsedCurves.get(key);
    if (!value) {
      value = parseCurve(t, name);
      parsedCurves.set(key, value);
    }
    return value;
  };
  return { matrix, curves: ['rTRC', 'gTRC', 'bTRC'].map(curve) as RgbProfile['curves'] };
}

const clamp = (x: number) => Math.max(0, Math.min(1, x));
export function curveValue(curve: Curve, value: number, inverse = false): number {
  if (curve.kind === 'srgb') {
    const x = Math.abs(value),
      sign = Math.sign(value);
    return (
      sign *
      (inverse
        ? x <= 0.0031308
          ? 12.92 * x
          : 1.055 * x ** (1 / 2.4) - 0.055
        : x <= 0.04045
          ? x / 12.92
          : ((x + 0.055) / 1.055) ** 2.4)
    );
  }
  if (curve.kind === 'table') {
    const v = curve.values,
      last = v.length - 1;
    if (!inverse) {
      const x = clamp(value) * last,
        i = Math.floor(x);
      return v[i] + (v[Math.min(i + 1, last)] - v[i]) * (x - i);
    }
    if (value <= v[0]) return 0;
    if (value >= v[last]) return 1;
    let lo = 0,
      hi = last;
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      if (v[mid] < value) lo = mid;
      else hi = mid;
    }
    return (lo + (value - v[lo]) / (v[hi] - v[lo])) / last;
  }
  const [g, a = 1, b = 0, c = 0, d = 0, e = 0, f = 0] = curve.parameters,
    type = curve.type;
  // An identity TRC is also the linear RGB encoding of 32-bit HDR
  // documents. Retain extended-range coordinates for matrix conversion.
  if (!type && g === 1) return value;
  const x = clamp(value);
  if (!type) return x ** (inverse ? 1 / g : g);
  if (!inverse) {
    if (type < 3)
      return clamp(
        x >= -b / a ? Math.max(0, a * x + b) ** g + (type === 2 ? c : 0) : type === 2 ? c : 0,
      );
    return clamp(
      x >= d ? Math.max(0, a * x + b) ** g + (type === 4 ? e : 0) : c * x + (type === 4 ? f : 0),
    );
  }
  if (type < 3) return clamp((Math.max(0, x - (type === 2 ? c : 0)) ** (1 / g) - b) / a);
  const highOffset = type === 4 ? e : 0,
    lowOffset = type === 4 ? f : 0;
  const split = Math.max(0, a * d + b) ** g + highOffset;
  return clamp(
    x >= split ? (Math.max(0, x - highOffset) ** (1 / g) - b) / a : c > 0 ? (x - lowOffset) / c : 0,
  );
}

export type ColorTransform = {
  matrix: number[];
  input: RgbProfile['curves'];
  output: RgbProfile['curves'];
};
export function colorTransform(source: RgbProfile, destination: RgbProfile): ColorTransform {
  return {
    matrix: multiplyMatrix(inverseMatrix(destination.matrix), source.matrix),
    input: source.curves,
    output: destination.curves,
  };
}
export function convertRgb(transform: ColorTransform, rgb: number[]): number[] {
  const linear = rgb.map((n, i) => curveValue(transform.input[i], n));
  return vector(transform.matrix, linear).map((n, i) => curveValue(transform.output[i], n, true));
}

// Pack the matrix and exact curve parameters/tables into a float texture. No
// resampled LUT is introduced. Each curve occupies three RGBA header texels.
export function packColorTransform(transform: ColorTransform, maxWidth: number) {
  if (!Number.isInteger(maxWidth) || maxWidth < 1)
    throw new ProfileError('Invalid GPU color texture limit.');
  const header = 12 + 6 * 12;
  const curves = [...transform.input, ...transform.output];
  const count =
    header +
    [...new Set(curves)].reduce((n, c) => n + (c.kind === 'table' ? c.values.length : 0), 0);
  const width = Math.min(maxWidth, Math.ceil(count / 4)),
    height = Math.ceil(count / (width * 4));
  if (height > maxWidth) throw new ProfileError('ICC tone curves exceed GPU texture limits.');
  const data = new Float32Array(width * height * 4);
  for (let i = 0; i < 3; i++) data.set(transform.matrix.slice(i * 3, i * 3 + 3), i * 4);
  let offset = header;
  const tables = new Map<Curve, number>();
  curves.forEach((curve, i) => {
    const at = 12 + i * 12;
    if (curve.kind === 'srgb') data[at] = 6;
    else if (curve.kind === 'parametric') {
      data[at] = curve.type;
      data.set(curve.parameters, at + 1);
    } else {
      data[at] = 5;
      let pointer = tables.get(curve);
      if (pointer === undefined) {
        pointer = offset;
        tables.set(curve, pointer);
        data.set(curve.values, offset);
        offset += curve.values.length;
      }
      data.set([pointer, curve.values.length], at + 8);
    }
  });
  if (!data.every(Number.isFinite))
    throw new ProfileError('ICC transform exceeds GPU float precision.');
  return { width, height, data };
}
