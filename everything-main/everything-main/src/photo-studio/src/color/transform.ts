// Color transforms between any two profiles (the CMM). A transform runs the
// source device -> D50 XYZ side, an affine PCS adjustment (ICC-absolute media
// white scaling or black point compensation) and the XYZ -> destination side.
// Matrix/TRC pairs fuse into shaper-matrix-shaper; anything can be baked into
// a 3D LUT for the GPU compositor, soft proofing and fast 8-bit conversion.
import { checkCancelled, type Progress, type RGBA8 } from '../imaging/types';
import { builtinProfile } from './builtin-profiles';
import { D50, labToXYZ, mat3Inv, mat3Mul, PERCEPTUAL_BLACK, xyzToLab, type Vec3 } from './color-math';
import {
  compileCurve,
  compileInverseCurve,
  deviceToXYZ,
  selectTag,
  xyzToDevice,
  type Intent,
  type Profile,
  type Stage,
} from './icc-lut';

export type TransformOptions = { bpc?: boolean; clamp?: boolean };
export type ColorTransform = {
  src: Profile;
  dst: Profile;
  intent: Intent;
  bpc: boolean;
  inChannels: number;
  outChannels: number;
  // Interleaved samples in [0, 1]; count defaults to input.length / inChannels.
  apply(input: ArrayLike<number>, output: Float32Array | Float64Array, count?: number): void;
  one(values: ArrayLike<number>): number[];
  // Fused shaper/matrix/shaper parameters when both ends are matrix/TRC.
  shaper?: { inCurves: ((x: number) => number)[]; matrix: number[]; offset: Vec3; outCurves: ((x: number) => number)[] };
  // RGB matrix/TRC -> Gray TRC: gray = outCurve(weights . linear + offset).
  grayShaper?: { inCurves: ((x: number) => number)[]; weights: Vec3; offset: number; outCurve: (x: number) => number };
};

const evalStages = (stages: Stage[], v: Float64Array) => {
  for (let i = 0; i < stages.length; i++) stages[i](v);
};

const bpCache = new Map<string, Vec3>();
// Black point of a profile for an intent, neutralized to the PCS gray axis so
// compensation never shifts hue. v4 perceptual/saturation tables share the
// reference medium black. Output (CMYK and other n-color) profiles report the
// darkest reproducible color: PCS black round-tripped through B2A and A2B.
export function detectBlackPoint(p: Profile, intent: Intent): Vec3 {
  const key = `${p.key}|${intent}`;
  const hit = bpCache.get(key);
  if (hit) return hit;
  let xyz: Vec3 = [0, 0, 0];
  const lutIntent = intent === 'perceptual' || intent === 'saturation';
  const v = new Float64Array(16);
  if (p.version >= 4 && lutIntent && selectTag(p.a2b, intent)) xyz = [...PERCEPTUAL_BLACK];
  else if (p.colorSpace === 'Lab' || p.colorSpace === 'XYZ') xyz = [0, 0, 0];
  else {
    if (p.channels > 3 && selectTag(p.b2a, intent)) {
      v.fill(0);
      evalStages(xyzToDevice(p, intent).stages, v);
    } else {
      v.fill(0);
      // Additive spaces are black at zero; CMY-like spaces at full colorant.
      if (p.colorSpace === 'CMY' || p.channels > 3) v.fill(1, 0, p.channels);
    }
    evalStages(deviceToXYZ(p, intent).stages, v);
    xyz = [v[0], v[1], v[2]];
  }
  const lab = xyzToLab(xyz);
  const L = Math.max(0, Math.min(50, lab[0]));
  const neutral = labToXYZ([L, 0, 0]) as Vec3;
  bpCache.set(key, neutral);
  return neutral;
}

// Affine PCS adjustment out = in * scale + offset (per XYZ component).
function pcsAdjustment(src: Profile, dst: Profile, intent: Intent, bpc: boolean) {
  const scale: Vec3 = [1, 1, 1],
    offset: Vec3 = [0, 0, 0];
  if (intent === 'absolute') {
    for (let i = 0; i < 3; i++) scale[i] = src.mediaWhite[i] / dst.mediaWhite[i];
  } else if (bpc) {
    // Black point compensation as a linear scaling in XYZ that keeps the PCS
    // white fixed and maps the source black point onto the destination's
    // (the concept described in ISO 18619; this is our own formulation).
    const ys = detectBlackPoint(src, intent)[1],
      yd = detectBlackPoint(dst, intent)[1];
    if (Math.abs(ys - yd) > 1e-6 && ys < 1) {
      const s = (1 - yd) / (1 - ys);
      for (let i = 0; i < 3; i++) {
        scale[i] = s;
        offset[i] = D50[i] * (yd - ys * s);
      }
    }
  }
  const identity = scale.every((n) => n === 1) && offset.every((n) => n === 0);
  return { scale, offset, identity };
}

export function createTransform(
  src: Profile,
  dst: Profile,
  intent: Intent = 'relative',
  opts: TransformOptions = {},
): ColorTransform {
  const bpc = !!opts.bpc && intent !== 'absolute';
  const clamp = opts.clamp ?? true;
  const a = deviceToXYZ(src, intent),
    b = xyzToDevice(dst, intent);
  const adj = pcsAdjustment(src, dst, intent, bpc);
  const nIn = a.channels,
    nOut = b.channels;
  let shaper: ColorTransform['shaper'];
  let stages: Stage[];
  if (a.shaper && b.shaper) {
    const m = mat3Mul(
      mat3Inv(b.shaper.matrix),
      mat3Mul([adj.scale[0], 0, 0, 0, adj.scale[1], 0, 0, 0, adj.scale[2]], a.shaper.matrix),
    );
    const inv = mat3Inv(b.shaper.matrix);
    const o = adj.offset;
    const off: Vec3 = [0, 1, 2].map((r) => inv[r * 3] * o[0] + inv[r * 3 + 1] * o[1] + inv[r * 3 + 2] * o[2]) as Vec3;
    shaper = {
      inCurves: a.shaper.curves.map(compileCurve),
      matrix: m,
      offset: off,
      outCurves: b.shaper.curves.map(compileInverseCurve),
    };
    const [i0, i1, i2] = shaper.inCurves,
      [o0, o1, o2] = shaper.outCurves;
    stages = [
      (v) => {
        const r = i0(v[0]),
          g = i1(v[1]),
          bl = i2(v[2]);
        v[0] = o0(m[0] * r + m[1] * g + m[2] * bl + off[0]);
        v[1] = o1(m[3] * r + m[4] * g + m[5] * bl + off[1]);
        v[2] = o2(m[6] * r + m[7] * g + m[8] * bl + off[2]);
      },
    ];
  } else {
    stages = [...a.stages];
    if (!adj.identity) {
      const { scale, offset } = adj;
      stages.push((v) => {
        v[0] = v[0] * scale[0] + offset[0];
        v[1] = v[1] * scale[1] + offset[1];
        v[2] = v[2] * scale[2] + offset[2];
      });
    }
    stages.push(...b.stages);
  }
  let grayShaper: ColorTransform['grayShaper'];
  if (a.shaper && dst.colorSpace === 'GRAY' && dst.pcs === 'XYZ' && dst.trc && !selectTag(dst.b2a, intent)) {
    const m = a.shaper.matrix;
    grayShaper = {
      inCurves: a.shaper.curves.map(compileCurve),
      weights: [m[3] * adj.scale[1], m[4] * adj.scale[1], m[5] * adj.scale[1]],
      offset: adj.offset[1],
      outCurve: compileInverseCurve(dst.trc[0]),
    };
  }
  const v = new Float64Array(16);
  const apply: ColorTransform['apply'] = (input, output, count) => {
    const n = count ?? Math.floor(input.length / nIn);
    for (let p = 0, ip = 0, op = 0; p < n; p++, ip += nIn, op += nOut) {
      for (let c = 0; c < nIn; c++) v[c] = input[ip + c];
      for (let s = 0; s < stages.length; s++) stages[s](v);
      if (clamp)
        for (let c = 0; c < nOut; c++) {
          const x = v[c];
          output[op + c] = x > 0 ? (x < 1 ? x : 1) : 0;
        }
      else for (let c = 0; c < nOut; c++) output[op + c] = v[c];
    }
  };
  return {
    src,
    dst,
    intent,
    bpc,
    inChannels: nIn,
    outChannels: nOut,
    apply,
    one: (values) => {
      const out = new Float64Array(nOut);
      apply(values, out, 1);
      return Array.from(out);
    },
    shaper,
    grayShaper,
  };
}

// Run two transforms back to back (document -> proof -> display, for example).
export function chainTransforms(...list: ColorTransform[]): ColorTransform {
  const first = list[0],
    last = list[list.length - 1];
  const maxCh = 16;
  const bufA = new Float64Array(maxCh),
    bufB = new Float64Array(maxCh);
  const apply: ColorTransform['apply'] = (input, output, count) => {
    const n = count ?? Math.floor(input.length / first.inChannels);
    for (let p = 0; p < n; p++) {
      for (let c = 0; c < first.inChannels; c++) bufA[c] = input[p * first.inChannels + c];
      let cur = bufA,
        next = bufB;
      for (const t of list) {
        t.apply(cur, next, 1);
        [cur, next] = [next, cur];
      }
      for (let c = 0; c < last.outChannels; c++) output[p * last.outChannels + c] = cur[c];
    }
  };
  return {
    src: first.src,
    dst: last.dst,
    intent: first.intent,
    bpc: first.bpc,
    inChannels: first.inChannels,
    outChannels: last.outChannels,
    apply,
    one: (values) => {
      const out = new Float64Array(last.outChannels);
      apply(values, out, 1);
      return Array.from(out);
    },
  };
}

// --- Baking ---------------------------------------------------------------

// 3D LUT over a 3-channel input, RGBA float with red varying fastest (the
// layout of a WebGL/WebGPU 3D texture). Gray outputs are replicated to RGB,
// 3-channel outputs get A = 1 and 4-channel outputs (CMYK) fill all four.
export type Lut3D = { size: number; outChannels: number; data: Float32Array };
export function bakeLut3D(t: ColorTransform, size = 33): Lut3D {
  if (t.inChannels !== 3) throw new Error('A 3D LUT needs a three-channel source.');
  if (t.outChannels > 4) throw new Error('A 3D LUT holds at most four output channels.');
  const n = size,
    total = n * n * n;
  const input = new Float32Array(total * 3);
  for (let b = 0, i = 0; b < n; b++)
    for (let g = 0; g < n; g++)
      for (let r = 0; r < n; r++, i += 3) {
        input[i] = r / (n - 1);
        input[i + 1] = g / (n - 1);
        input[i + 2] = b / (n - 1);
      }
  const out = new Float32Array(total * t.outChannels);
  t.apply(input, out, total);
  const data = new Float32Array(total * 4);
  const k = t.outChannels;
  for (let i = 0; i < total; i++) {
    const o = i * 4,
      s = i * k;
    if (k === 1) {
      data[o] = data[o + 1] = data[o + 2] = out[s];
      data[o + 3] = 1;
    } else {
      for (let c = 0; c < k; c++) data[o + c] = out[s + c];
      if (k < 4) data[o + 3] = 1;
    }
  }
  return { size: n, outChannels: k, data };
}

// 4D LUT for CMYK sources (C slowest, K fastest), 3 or fewer outputs padded to 4.
export type Lut4D = { size: number; outChannels: number; data: Float32Array };
export function bakeLut4D(t: ColorTransform, size = 17): Lut4D {
  if (t.inChannels !== 4) throw new Error('A 4D LUT needs a four-channel source.');
  const n = size,
    total = n ** 4,
    k = t.outChannels;
  const input = new Float32Array(total * 4);
  for (let i = 0; i < total; i++) {
    input[i * 4] = Math.floor(i / (n * n * n)) / (n - 1);
    input[i * 4 + 1] = (Math.floor(i / (n * n)) % n) / (n - 1);
    input[i * 4 + 2] = (Math.floor(i / n) % n) / (n - 1);
    input[i * 4 + 3] = (i % n) / (n - 1);
  }
  const out = new Float32Array(total * k);
  t.apply(input, out, total);
  const data = new Float32Array(total * 4);
  for (let i = 0; i < total; i++) {
    if (k === 1) data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = out[i];
    else for (let c = 0; c < k; c++) data[i * 4 + c] = out[i * k + c];
    if (k < 4) data[i * 4 + 3] = 1;
  }
  return { size: n, outChannels: k, data };
}

// 1D shaper tables plus a 3x3 matrix and offset (only when both ends are
// matrix/TRC): linear = inCurves[c](x), out = outCurves[c](M * linear + offset),
// each table sampled uniformly over [0, 1].
export type ShaperTables = { size: number; inCurves: Float32Array[]; matrix: Float32Array; offset: Float32Array; outCurves: Float32Array[] };
export function bakeShaperTables(t: ColorTransform, size = 4096): ShaperTables | null {
  if (!t.shaper) return null;
  const s = t.shaper;
  const table = (f: (x: number) => number) => Float32Array.from({ length: size }, (_, i) => f(i / (size - 1)));
  return {
    size,
    inCurves: s.inCurves.map(table),
    matrix: Float32Array.from(s.matrix),
    offset: Float32Array.from(s.offset),
    outCurves: s.outCurves.map(table),
  };
}

// Sample a 3D LUT (tetrahedral) at a float RGB point; out receives 4 values.
export function sampleLut3D(lut: Lut3D, r: number, g: number, b: number, out: Float64Array | number[]) {
  const n = lut.size,
    d = lut.data,
    m = n - 1;
  const loc = (x: number) => {
    const p = (x > 0 ? (x < 1 ? x : 1) : 0) * m;
    const i = Math.min(p | 0, m - 1);
    return [i, p - i];
  };
  const [ir, fr] = loc(r),
    [ig, fg] = loc(g),
    [ib, fb] = loc(b);
  const sr = 4,
    sg = 4 * n,
    sb = 4 * n * n;
  tetraRGBA(d, ir * sr + ig * sg + ib * sb, fr, fg, fb, sr, sg, sb, out, 0);
}

function tetraRGBA(
  d: Float32Array,
  base: number,
  fr: number,
  fg: number,
  fb: number,
  sr: number,
  sg: number,
  sb: number,
  out: Float64Array | number[] | Float32Array,
  at: number,
) {
  let a: number, b: number, wa: number, wb: number, wc: number;
  const c = sr + sg + sb;
  if (fr >= fg) {
    if (fg >= fb) { a = sr; b = sr + sg; wa = fr; wb = fg; wc = fb; }
    else if (fr >= fb) { a = sr; b = sr + sb; wa = fr; wb = fb; wc = fg; }
    else { a = sb; b = sr + sb; wa = fb; wb = fr; wc = fg; }
  } else if (fb >= fg) { a = sb; b = sg + sb; wa = fb; wb = fg; wc = fr; }
  else if (fb >= fr) { a = sg; b = sg + sb; wa = fg; wb = fb; wc = fr; }
  else { a = sg; b = sr + sg; wa = fg; wb = fr; wc = fb; }
  for (let k = 0; k < 4; k++) {
    const v0 = d[base + k],
      va = d[base + a + k],
      vb = d[base + b + k],
      vc = d[base + c + k];
    out[at + k] = v0 + wa * (va - v0) + wb * (vb - va) + wc * (vc - vb);
  }
}

// --- Whole-image helpers -------------------------------------------------

type Grid8 = { index: Int32Array; frac: Float32Array };
function grid8(n: number): Grid8 {
  const index = new Int32Array(256),
    frac = new Float32Array(256);
  for (let v = 0; v < 256; v++) {
    const p = (v * (n - 1)) / 255;
    const i = Math.min(Math.floor(p), n - 2);
    index[v] = i;
    frac[v] = p - i;
  }
  return { index, frac };
}

// Interpolate a 3D LUT (tetrahedral) for every pixel of an 8-bit image, one
// row at a time: `row` receives 4 values per pixel. The kernel is inlined
// and monomorphic; runs of identical pixels reuse the previous result.
export function lutRows(img: RGBA8, lut: Lut3D, row: (y: number, values: Float32Array) => void, progress?: Progress) {
  const n = lut.size,
    d = lut.data,
    { index, frac } = grid8(n);
  const sr = 4,
    sg = 4 * n,
    sb = 4 * n * n,
    sAll = sr + sg + sb;
  const offR = new Int32Array(256),
    offG = new Int32Array(256),
    offB = new Int32Array(256);
  for (let v = 0; v < 256; v++) {
    offR[v] = index[v] * sr;
    offG[v] = index[v] * sg;
    offB[v] = index[v] * sb;
  }
  const src = img.data,
    w = img.width;
  const out = new Float32Array(w * 4);
  let last = -1,
    o0 = 0,
    o1 = 0,
    o2 = 0,
    o3 = 0;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0, i = y * w * 4, o = 0; x < w; x++, i += 4, o += 4) {
      const r = src[i],
        g = src[i + 1],
        b = src[i + 2];
      const key = (r << 16) | (g << 8) | b;
      if (key !== last) {
        last = key;
        const fr = frac[r],
          fg = frac[g],
          fb = frac[b];
        const base = offR[r] + offG[g] + offB[b];
        let a: number, bb: number, wa: number, wb: number, wc: number;
        if (fr >= fg) {
          if (fg >= fb) { a = sr; bb = sr + sg; wa = fr; wb = fg; wc = fb; }
          else if (fr >= fb) { a = sr; bb = sr + sb; wa = fr; wb = fb; wc = fg; }
          else { a = sb; bb = sr + sb; wa = fb; wb = fr; wc = fg; }
        } else if (fb >= fg) { a = sb; bb = sg + sb; wa = fb; wb = fg; wc = fr; }
        else if (fb >= fr) { a = sg; bb = sg + sb; wa = fg; wb = fb; wc = fr; }
        else { a = sg; bb = sr + sg; wa = fg; wb = fr; wc = fb; }
        const p0 = base,
          pa = base + a,
          pb = base + bb,
          pc = base + sAll;
        let v0 = d[p0],
          va = d[pa],
          vb = d[pb];
        o0 = v0 + wa * (va - v0) + wb * (vb - va) + wc * (d[pc] - vb);
        v0 = d[p0 + 1];
        va = d[pa + 1];
        vb = d[pb + 1];
        o1 = v0 + wa * (va - v0) + wb * (vb - va) + wc * (d[pc + 1] - vb);
        v0 = d[p0 + 2];
        va = d[pa + 2];
        vb = d[pb + 2];
        o2 = v0 + wa * (va - v0) + wb * (vb - va) + wc * (d[pc + 2] - vb);
        v0 = d[p0 + 3];
        va = d[pa + 3];
        vb = d[pb + 3];
        o3 = v0 + wa * (va - v0) + wb * (vb - va) + wc * (d[pc + 3] - vb);
      }
      out[o] = o0;
      out[o + 1] = o1;
      out[o + 2] = o2;
      out[o + 3] = o3;
    }
    row(y, out);
    if ((y & 63) === 63) {
      checkCancelled(progress);
      progress?.report?.((y + 1) / img.height);
    }
  }
}

const to8 = (x: number) => (x <= 0 ? 0 : x >= 1 ? 255 : (x * 255 + 0.5) | 0);

// Convert an RGBA8 image through an RGB->RGB (or RGB->Gray, replicated) transform.
// Matrix/TRC pairs use exact 1D tables; everything else a baked 33^3 LUT.
export function transformRGBA8(img: RGBA8, t: ColorTransform | Lut3D, progress?: Progress): RGBA8 {
  const out = new Uint8ClampedArray(img.data.length);
  const src = img.data;
  if ('apply' in t && t.shaper && t.outChannels === 3) {
    const { inCurves, matrix: m, offset: o, outCurves } = t.shaper;
    const lin = inCurves.map((f) => Float32Array.from({ length: 256 }, (_, i) => f(i / 255)));
    // Output tables are indexed by sqrt(linear) so gamma-like inverse curves
    // stay accurate near black with a modest table.
    const N = 4096;
    const enc = outCurves.map((f) =>
      Uint8Array.from({ length: N + 1 }, (_, i) => to8(f((i / N) * (i / N)))),
    );
    const [l0, l1, l2] = lin,
      [e0, e1, e2] = enc;
    const q = (x: number) => (x <= 0 ? 0 : x >= 1 ? N : (Math.sqrt(x) * N + 0.5) | 0);
    for (let i = 0; i < src.length; i += 4) {
      const r = l0[src[i]],
        g = l1[src[i + 1]],
        b = l2[src[i + 2]];
      out[i] = e0[q(m[0] * r + m[1] * g + m[2] * b + o[0])];
      out[i + 1] = e1[q(m[3] * r + m[4] * g + m[5] * b + o[1])];
      out[i + 2] = e2[q(m[6] * r + m[7] * g + m[8] * b + o[2])];
      out[i + 3] = src[i + 3];
    }
    return { width: img.width, height: img.height, data: out };
  }
  const lut = 'apply' in t ? bakeLut3D(t) : t;
  if (lut.outChannels === 4) throw new Error('Use transformToCMYK for four-channel output.');
  const w = img.width;
  lutRows(img, lut, (y, v) => {
    for (let x = 0, i = y * w * 4, o = 0; x < w; x++, i += 4, o += 4) {
      out[i] = to8(v[o]);
      out[i + 1] = to8(v[o + 1]);
      out[i + 2] = to8(v[o + 2]);
      out[i + 3] = src[i + 3];
    }
  }, progress);
  return { width: img.width, height: img.height, data: out };
}

// Single-channel output (gray) as a plane plus alpha.
export function transformToGray(img: RGBA8, t: ColorTransform | Lut3D): { gray: Uint8Array; alpha: Uint8Array } {
  const px = img.width * img.height;
  const gray = new Uint8Array(px),
    alpha = new Uint8Array(px);
  const src = img.data;
  if ('apply' in t && t.grayShaper) {
    // Exact path: 8-bit linearization tables, luminance weights, and an
    // output table indexed by sqrt(Y) for precision near black.
    const { inCurves, weights: w, offset, outCurve } = t.grayShaper;
    const lin = inCurves.map((f, c) => Float32Array.from({ length: 256 }, (_, i) => f(i / 255) * w[c]));
    const N = 4096;
    const enc = Uint8Array.from({ length: N + 1 }, (_, i) => to8(outCurve((i / N) * (i / N))));
    const [l0, l1, l2] = lin;
    for (let p = 0, i = 0; p < px; p++, i += 4) {
      const y = l0[src[i]] + l1[src[i + 1]] + l2[src[i + 2]] + offset;
      gray[p] = enc[y <= 0 ? 0 : y >= 1 ? N : (Math.sqrt(y) * N + 0.5) | 0];
      alpha[p] = src[i + 3];
    }
    return { gray, alpha };
  }
  const lut = 'apply' in t ? bakeLut3D(t) : t;
  const w = img.width;
  lutRows(img, lut, (y, v) => {
    for (let x = 0, p = y * w; x < w; x++, p++) {
      gray[p] = to8(v[x * 4]);
      alpha[p] = src[p * 4 + 3];
    }
  });
  return { gray, alpha };
}

export type CMYKPlanes = {
  width: number;
  height: number;
  // Ink amount, 0 = no ink, 255 = 100% (PSD stores the inverse).
  c: Uint8Array;
  m: Uint8Array;
  y: Uint8Array;
  k: Uint8Array;
  alpha: Uint8Array;
};
// Without a transform: sRGB -> Generic Coated CMYK, relative colorimetric + BPC.
export function transformToCMYK(img: RGBA8, t?: ColorTransform | Lut3D, progress?: Progress): CMYKPlanes {
  t ??= cachedTransform(builtinProfile('srgb'), builtinProfile('generic-coated-cmyk'), 'relative', { bpc: true });
  const lut = 'apply' in t ? bakeLut3D(t) : t;
  if (lut.outChannels !== 4) throw new Error('The transform does not produce CMYK.');
  const px = img.width * img.height;
  const planes: CMYKPlanes = {
    width: img.width,
    height: img.height,
    c: new Uint8Array(px),
    m: new Uint8Array(px),
    y: new Uint8Array(px),
    k: new Uint8Array(px),
    alpha: new Uint8Array(px),
  };
  const w = img.width;
  lutRows(img, lut, (y, v) => {
    for (let x = 0, p = y * w, o = 0; x < w; x++, p++, o += 4) {
      planes.c[p] = to8(v[o]);
      planes.m[p] = to8(v[o + 1]);
      planes.y[p] = to8(v[o + 2]);
      planes.k[p] = to8(v[o + 3]);
      planes.alpha[p] = img.data[p * 4 + 3];
    }
  }, progress);
  return planes;
}

// CMYK planes -> RGBA8 through a CMYK->RGB transform baked to a 4D LUT.
export function cmykToRGBA8(planes: CMYKPlanes, t: ColorTransform | Lut4D): RGBA8 {
  const lut = 'apply' in t ? bakeLut4D(t) : t;
  const n = lut.size,
    d = lut.data,
    { index, frac } = grid8(n);
  const sk = 4,
    sy = 4 * n,
    sm = 4 * n * n,
    sc = 4 * n * n * n;
  const px = planes.width * planes.height;
  const out = new Uint8ClampedArray(px * 4);
  const lo = new Float32Array(4),
    hi = new Float32Array(4);
  for (let p = 0; p < px; p++) {
    const c = planes.c[p],
      m = planes.m[p],
      y = planes.y[p],
      k = planes.k[p];
    const base = index[m] * sm + index[y] * sy + index[k] * sk;
    const fc = frac[c],
      ic = index[c] * sc;
    tetraRGBA(d, base + ic, frac[m], frac[y], frac[k], sm, sy, sk, lo, 0);
    if (fc > 0) tetraRGBA(d, base + ic + sc, frac[m], frac[y], frac[k], sm, sy, sk, hi, 0);
    const i = p * 4;
    for (let ch = 0; ch < 3; ch++) out[i + ch] = to8(fc > 0 ? lo[ch] + (hi[ch] - lo[ch]) * fc : lo[ch]);
    out[i + 3] = planes.alpha[p];
  }
  return { width: planes.width, height: planes.height, data: out };
}

// Small LRU of transforms keyed by profile identity, intent and options.
const tcache = new Map<string, ColorTransform>();
export function cachedTransform(src: Profile, dst: Profile, intent: Intent = 'relative', opts: TransformOptions = {}): ColorTransform {
  const key = `${src.key}>${dst.key}|${intent}|${!!opts.bpc}|${opts.clamp ?? true}`;
  let t = tcache.get(key);
  if (t) {
    tcache.delete(key);
    tcache.set(key, t);
    return t;
  }
  t = createTransform(src, dst, intent, opts);
  tcache.set(key, t);
  if (tcache.size > 32) tcache.delete(tcache.keys().next().value!);
  return t;
}
