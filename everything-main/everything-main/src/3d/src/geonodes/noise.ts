// CPU gradient noise matching the project's GLSL noise library (shader/glsl/noise.ts), so the
// Noise Texture node gives the same pattern in geometry nodes and in materials.

const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);

export function pcg(v: number): number {
  const s = (Math.imul(v >>> 0, 747796405) + 2891336453) >>> 0;
  const w = Math.imul(((s >>> ((s >>> 28) + 4)) ^ s) >>> 0, 277803737) >>> 0;
  return ((w >>> 22) ^ w) >>> 0;
}
export const hash1 = (a: number) => pcg(a);
export const hash2 = (a: number, b: number) => pcg((a ^ pcg((b + 0x9e3779b9) >>> 0)) >>> 0);
export const hash3 = (a: number, b: number, c: number) => pcg((a ^ pcg((b ^ pcg((c + 0x7f4a7c15) >>> 0)) >>> 0)) >>> 0);
export const hash4 = (a: number, b: number, c: number, d: number) => pcg((a ^ pcg((b ^ pcg((c ^ pcg((d + 0x632be5ab) >>> 0)) >>> 0)) >>> 0)) >>> 0);
export const u2f = (h: number) => h / 4294967296;
export function floatBits(x: number) {
  f32[0] = x;
  return u32[0];
}
export const hashF1 = (x: number) => u2f(hash1(floatBits(x)));

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

function g1(h: number, x: number) {
  const g = (h & 7) + 1;
  return ((h & 8) === 0 ? g : -g) * x;
}
function g2(h: number, x: number, y: number) {
  const k = h & 7;
  const u = k < 4 ? x : y,
    v = k < 4 ? y : x;
  return ((k & 1) === 0 ? u : -u) + ((k & 2) === 0 ? 2 * v : -2 * v);
}
function g3(h: number, x: number, y: number, z: number) {
  const k = h & 15;
  const u = k < 8 ? x : y;
  const v = k < 4 ? y : k === 12 || k === 14 ? x : z;
  return ((k & 1) === 0 ? u : -u) + ((k & 2) === 0 ? v : -v);
}
function g4(h: number, x: number, y: number, z: number, w: number) {
  const k = h & 31;
  const u = k < 24 ? x : y,
    v = k < 16 ? y : z,
    ww = k < 8 ? z : w;
  return ((k & 1) === 0 ? u : -u) + ((k & 2) === 0 ? v : -v) + ((k & 4) === 0 ? ww : -ww);
}

export function snoise1(p: number) {
  const i = Math.floor(p),
    f = p - i;
  return 0.25 * mix(g1(hash1(i >>> 0), f), g1(hash1((i + 1) >>> 0), f - 1), fade(f));
}
export function snoise2(x: number, y: number) {
  const ix = Math.floor(x),
    iy = Math.floor(y),
    fx = x - ix,
    fy = y - iy;
  const a = g2(hash2(ix >>> 0, iy >>> 0), fx, fy),
    b = g2(hash2((ix + 1) >>> 0, iy >>> 0), fx - 1, fy);
  const d = g2(hash2(ix >>> 0, (iy + 1) >>> 0), fx, fy - 1),
    e = g2(hash2((ix + 1) >>> 0, (iy + 1) >>> 0), fx - 1, fy - 1);
  return 0.6616 * mix(mix(a, b, fade(fx)), mix(d, e, fade(fx)), fade(fy)) * 0.5;
}
export function snoise3(x: number, y: number, z: number) {
  const ix = Math.floor(x),
    iy = Math.floor(y),
    iz = Math.floor(z);
  const fx = x - ix,
    fy = y - iy,
    fz = z - iz;
  const ux = fade(fx),
    uy = fade(fy),
    uz = fade(fz);
  const X0 = ix >>> 0,
    X1 = (ix + 1) >>> 0,
    Y0 = iy >>> 0,
    Y1 = (iy + 1) >>> 0,
    Z0 = iz >>> 0,
    Z1 = (iz + 1) >>> 0;
  const n000 = g3(hash3(X0, Y0, Z0), fx, fy, fz);
  const n100 = g3(hash3(X1, Y0, Z0), fx - 1, fy, fz);
  const n010 = g3(hash3(X0, Y1, Z0), fx, fy - 1, fz);
  const n110 = g3(hash3(X1, Y1, Z0), fx - 1, fy - 1, fz);
  const n001 = g3(hash3(X0, Y0, Z1), fx, fy, fz - 1);
  const n101 = g3(hash3(X1, Y0, Z1), fx - 1, fy, fz - 1);
  const n011 = g3(hash3(X0, Y1, Z1), fx, fy - 1, fz - 1);
  const n111 = g3(hash3(X1, Y1, Z1), fx - 1, fy - 1, fz - 1);
  return 0.982 * mix(mix(mix(n000, n100, ux), mix(n010, n110, ux), uy), mix(mix(n001, n101, ux), mix(n011, n111, ux), uy), uz);
}
export function snoise4(x: number, y: number, z: number, w: number) {
  const i = [Math.floor(x), Math.floor(y), Math.floor(z), Math.floor(w)];
  const f = [x - i[0], y - i[1], z - i[2], w - i[3]];
  const u = f.map(fade);
  const r = [0, 0];
  for (let ww = 0; ww < 2; ww++) {
    const n: number[] = [];
    for (let k = 0; k < 8; k++) {
      const o = [k & 1, (k >> 1) & 1, (k >> 2) & 1, ww];
      n.push(g4(hash4((i[0] + o[0]) >>> 0, (i[1] + o[1]) >>> 0, (i[2] + o[2]) >>> 0, (i[3] + o[3]) >>> 0), f[0] - o[0], f[1] - o[1], f[2] - o[2], f[3] - o[3]));
    }
    r[ww] = mix(mix(mix(n[0], n[1], u[0]), mix(n[2], n[3], u[0]), u[1]), mix(mix(n[4], n[5], u[0]), mix(n[6], n[7], u[0]), u[1]), u[2]);
  }
  return 0.8344 * mix(r[0], r[1], u[3]);
}

type P = number[];
function sn(p: P): number {
  switch (p.length) {
    case 1:
      return snoise1(p[0]);
    case 2:
      return snoise2(p[0], p[1]);
    case 3:
      return snoise3(p[0], p[1], p[2]);
    default:
      return snoise4(p[0], p[1], p[2], p[3]);
  }
}
const scale = (p: P, s: number) => p.map((x) => x * s);

export function fbm(p: P, detail: number, rough: number, lac: number, norm: boolean): number {
  let fs = 1,
    amp = 1,
    mx = 0,
    sum = 0;
  detail = Math.max(0, Math.min(15, detail));
  rough = Math.max(0, Math.min(1, rough));
  for (let i = 0; i <= Math.floor(detail); i++) {
    const t = sn(scale(p, fs));
    sum += t * amp;
    mx += amp;
    amp *= rough;
    fs *= lac;
  }
  const rmd = detail - Math.floor(detail);
  if (rmd !== 0) {
    const t = sn(scale(p, fs));
    const sum2 = sum + t * amp;
    return norm ? mix((0.5 * sum) / mx + 0.5, (0.5 * sum2) / (mx + amp) + 0.5, rmd) : mix(sum, sum2, rmd);
  }
  return norm ? (0.5 * sum) / mx + 0.5 : sum;
}

function multifractal(p: P, detail: number, rough: number, lac: number) {
  let v = 1,
    pwr = 1;
  detail = Math.max(0, Math.min(15, detail));
  for (let i = 0; i <= Math.floor(detail); i++) {
    v *= pwr * sn(p) + 1;
    pwr *= rough;
    p = scale(p, lac);
  }
  const rmd = detail - Math.floor(detail);
  if (rmd !== 0) v *= rmd * pwr * sn(p) + 1;
  return v;
}
function hetero(p: P, detail: number, rough: number, lac: number, offset: number) {
  let pwr = rough;
  detail = Math.max(0, Math.min(15, detail));
  let v = offset + sn(p);
  p = scale(p, lac);
  for (let i = 1; i <= Math.floor(detail); i++) {
    v += (sn(p) + offset) * pwr * v;
    pwr *= rough;
    p = scale(p, lac);
  }
  const rmd = detail - Math.floor(detail);
  if (rmd !== 0) v += rmd * ((sn(p) + offset) * pwr * v);
  return v;
}
function hybrid(p: P, detail: number, rough: number, lac: number, offset: number, gain: number) {
  let pwr = rough;
  detail = Math.max(0, Math.min(15, detail));
  let res = sn(p) + offset,
    w = gain * res;
  p = scale(p, lac);
  for (let i = 1; i <= Math.floor(detail) && w > 0.001; i++) {
    w = Math.min(w, 1);
    const s = (sn(p) + offset) * pwr;
    pwr *= rough;
    res += w * s;
    w *= gain * s;
    p = scale(p, lac);
  }
  const rmd = detail - Math.floor(detail);
  if (rmd !== 0 && w > 0.001) res += rmd * ((sn(p) + offset) * pwr);
  return res;
}
function ridged(p: P, detail: number, rough: number, lac: number, offset: number, gain: number) {
  let pwr = rough;
  detail = Math.max(0, Math.min(15, detail));
  let s = offset - Math.abs(sn(p));
  s *= s;
  let res = s;
  for (let i = 1; i <= Math.floor(detail); i++) {
    p = scale(p, lac);
    const w = Math.max(0, Math.min(1, s * gain));
    s = offset - Math.abs(sn(p));
    s *= s;
    s *= w;
    res += s * pwr;
    pwr *= rough;
  }
  return res;
}

export type NoiseType = 'MULTIFRACTAL' | 'RIDGED_MULTIFRACTAL' | 'HYBRID_MULTIFRACTAL' | 'FBM' | 'HETERO_TERRAIN';

export function noiseFractal(type: NoiseType, p: P, detail: number, rough: number, lac: number, offset: number, gain: number, norm: boolean) {
  switch (type) {
    case 'MULTIFRACTAL':
      return multifractal(p, detail, rough, lac);
    case 'RIDGED_MULTIFRACTAL':
      return ridged(p, detail, rough, lac, offset, gain);
    case 'HYBRID_MULTIFRACTAL':
      return hybrid(p, detail, rough, lac, offset, gain);
    case 'HETERO_TERRAIN':
      return hetero(p, detail, rough, lac, offset);
    default:
      return fbm(p, detail, rough, lac, norm);
  }
}

const rndOff = (s: number) => 100 + hashF1(s) * 100;

/** Noise Texture: returns [factor, r, g, b]. `p` has 1–4 components (already scaled). */
export function noiseTexture(p: P, detail: number, rough: number, lac: number, offset: number, gain: number, dist: number, type: NoiseType, norm: boolean): [number, number, number, number] {
  const d = p.length;
  if (dist !== 0) {
    const q = [...p];
    for (let a = 0; a < d; a++) {
      const o = p.map((x, k) => x + rndOff(a * d + k));
      q[a] += sn(o) * dist;
    }
    p = q;
  }
  const f = noiseFractal(type, p, detail, rough, lac, offset, gain, norm);
  const o1 = p.map((x, k) => x + rndOff(d * d + k));
  const o2 = p.map((x, k) => x + rndOff(d * d + d + k));
  return [f, f, noiseFractal(type, o1, detail, rough, lac, offset, gain, norm), noiseFractal(type, o2, detail, rough, lac, offset, gain, norm)];
}

/** Allocation-free 3D fBm (the common case). */
export function fbm3(x: number, y: number, z: number, detail: number, rough: number, lac: number, norm: boolean): number {
  let fs = 1,
    amp = 1,
    mx = 0,
    sum = 0;
  detail = Math.max(0, Math.min(15, detail));
  rough = Math.max(0, Math.min(1, rough));
  const oct = Math.floor(detail);
  for (let i = 0; i <= oct; i++) {
    sum += snoise3(x * fs, y * fs, z * fs) * amp;
    mx += amp;
    amp *= rough;
    fs *= lac;
  }
  const rmd = detail - oct;
  if (rmd !== 0) {
    const sum2 = sum + snoise3(x * fs, y * fs, z * fs) * amp;
    return norm ? mix((0.5 * sum) / mx + 0.5, (0.5 * sum2) / (mx + amp) + 0.5, rmd) : mix(sum, sum2, rmd);
  }
  return norm ? (0.5 * sum) / mx + 0.5 : sum;
}

const OFF3 = Array.from({ length: 15 }, (_, i) => rndOff(i));

/** 3D fBm Noise Texture without allocations; writes [fac, r, g, b] into out at o. */
export function noiseTexture3(x: number, y: number, z: number, detail: number, rough: number, lac: number, dist: number, norm: boolean, wantColor: boolean, out: Float32Array | number[], o: number) {
  if (dist !== 0) {
    const dx = snoise3(x + OFF3[0], y + OFF3[1], z + OFF3[2]) * dist,
      dy = snoise3(x + OFF3[3], y + OFF3[4], z + OFF3[5]) * dist,
      dz = snoise3(x + OFF3[6], y + OFF3[7], z + OFF3[8]) * dist;
    x += dx;
    y += dy;
    z += dz;
  }
  const f = fbm3(x, y, z, detail, rough, lac, norm);
  out[o] = f;
  if (wantColor) {
    out[o + 1] = f;
    out[o + 2] = fbm3(x + OFF3[9], y + OFF3[10], z + OFF3[11], detail, rough, lac, norm);
    out[o + 3] = fbm3(x + OFF3[12], y + OFF3[13], z + OFF3[14], detail, rough, lac, norm);
  }
}

// ---------------------------------------------------------------------------
// Random values (deterministic per id and seed)

export function randomFloat(id: number, seed: number, salt = 0): number {
  return u2f(hash3(id >>> 0, seed >>> 0, salt >>> 0));
}
