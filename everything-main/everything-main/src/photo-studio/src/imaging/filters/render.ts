// Render menu: procedural fills and light.
import type { OperationContext } from '../types';
import {
  clamp,
  defineOp,
  hexColor,
  lumaPlane,
  newImage,
  num,
  point,
  rand,
  rng,
  str,
  tick,
} from './common';

// Gradient noise after Perlin's "Improving Noise" (SIGGRAPH 2002) with a
// seeded permutation, and fractal sums of it (fBm).
export function permutation(seed: number): Uint8Array {
  const p = new Uint8Array(512), next = rng(seed ^ 0x51ed270b);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    const t = p[i]; p[i] = p[j]; p[j] = t;
  }
  for (let i = 0; i < 256; i++) p[i + 256] = p[i];
  return p;
}
const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
function grad(h: number, x: number, y: number) {
  switch (h & 7) {
    case 0: return x + y;
    case 1: return -x + y;
    case 2: return x - y;
    case 3: return -x - y;
    case 4: return x;
    case 5: return -x;
    case 6: return y;
    default: return -y;
  }
}
export function noise2(p: Uint8Array, x: number, y: number): number {
  const fx = Math.floor(x), fy = Math.floor(y);
  const X = fx & 255, Y = fy & 255;
  x -= fx; y -= fy;
  const u = fade(x), v = fade(y);
  const a = p[X] + Y, b = p[X + 1] + Y;
  const n00 = grad(p[a], x, y), n10 = grad(p[b], x - 1, y);
  const n01 = grad(p[a + 1], x, y - 1), n11 = grad(p[b + 1], x - 1, y - 1);
  const top = n00 + (n10 - n00) * u;
  return top + (n01 + (n11 - n01) * u - top) * v;
}
// Sum of `octaves` noise layers, each double the frequency and half the
// amplitude, offset so the layers do not align at the origin.
export function fbm(p: Uint8Array, x: number, y: number, octaves: number): number {
  let s = 0, amp = 1, f = 1;
  for (let o = 0; o < octaves; o++) {
    s += amp * noise2(p, x * f + o * 17.31, y * f + o * 9.17);
    amp *= 0.5;
    f *= 2;
  }
  return s;
}

// Clouds in document pixels, so a preview at a reduced scale shows the same
// pattern as the full render.
function cloudField(w: number, h: number, ctx: OperationContext, out: Float32Array) {
  const s = ctx.scale ?? 1, perm = permutation(ctx.seed ?? 0);
  const period = 256;
  const octaves = clamp(Math.ceil(Math.log2((period * s) / 1.5)), 1, 12);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) out[y * w + x] = clamp(0.5 + 0.55 * fbm(perm, x / s / period, y / s / period, octaves), 0, 1);
}

export const clouds = defineOp({
  id: 'clouds',
  label: 'Clouds',
  category: 'Render',
  params: [],
  immediate: true,
  run(src, _p, ctx) {
    const { width: w, height: h } = src;
    const v = new Float32Array(w * h);
    cloudField(w, h, ctx, v);
    const out = newImage(src), o = out.data, [f, b] = [ctx.foreground, ctx.background];
    for (let i = 0, j = 0; i < v.length; i++, j += 4) {
      const t = v[i];
      o[j] = f[0] + (b[0] - f[0]) * t; o[j + 1] = f[1] + (b[1] - f[1]) * t; o[j + 2] = f[2] + (b[2] - f[2]) * t; o[j + 3] = 255;
    }
    return out;
  },
});

export const differenceClouds = defineOp({
  id: 'difference-clouds',
  label: 'Difference Clouds',
  category: 'Render',
  params: [],
  immediate: true,
  run(src, _p, ctx) {
    const { width: w, height: h, data: d } = src;
    const v = new Float32Array(w * h);
    cloudField(w, h, ctx, v);
    const out = newImage(src), o = out.data, [f, b] = [ctx.foreground, ctx.background];
    for (let i = 0, j = 0; i < v.length; i++, j += 4) {
      const t = v[i];
      for (let c = 0; c < 3; c++) o[j + c] = Math.abs(d[j + c] - (f[c] + (b[c] - f[c]) * t));
      o[j + 3] = d[j + 3];
    }
    return out;
  },
});

export const fibers = defineOp({
  id: 'fibers',
  label: 'Fibers',
  category: 'Render',
  params: [
    { key: 'variance', label: 'Variance', type: 'number', min: 1, max: 64, step: 1, default: 16 },
    { key: 'strength', label: 'Strength', type: 'number', min: 1, max: 64, step: 1, default: 4 },
    { key: 'seed', label: 'Seed', type: 'number', min: 0, max: 99999, step: 1, default: 0 },
  ],
  run(src, p, ctx, progress) {
    const { width: w, height: h } = src;
    const perm = permutation((ctx.seed ?? 0) * 7919 + num(p, 'seed'));
    const s = ctx.scale ?? 1, variance = num(p, 'variance') / 16, len = num(p, 'strength') * 16;
    const out = newImage(src), o = out.data, [f, b] = [ctx.foreground, ctx.background];
    // Fine variation across x, long correlation along y: vertical fibers.
    for (let y = 0; y < h; y++) {
      tick(progress, y, h);
      for (let x = 0; x < w; x++) {
        const n = fbm(perm, x / s / 5, y / s / len, 4) + 0.35 * fbm(perm, x / s / 1.5 + 100, y / s / (len * 0.4), 2);
        const t = clamp(0.5 + n * variance * 0.6, 0, 1), j = (y * w + x) * 4;
        o[j] = f[0] + (b[0] - f[0]) * t; o[j + 1] = f[1] + (b[1] - f[1]) * t; o[j + 2] = f[2] + (b[2] - f[2]) * t; o[j + 3] = 255;
      }
    }
    return out;
  },
});

// ---------------------------------------------------------------------------
// Lens flare: an original procedural model (core, glow, halo ring, rays,
// streak and ghosts along the axis through the image center), composited
// with Screen so it only brightens.

type Ghost = { t: number; r: number; c: [number, number, number]; i: number; sx?: number };
type FlareStyle = {
  core: number; glow: number; glowI: number; halo: number; haloW: number; haloI: number;
  rays: number; rayI: number; streak: number; tint: [number, number, number]; ghosts: Ghost[];
};
const STYLES: Record<string, FlareStyle> = {
  classic: {
    core: 0.012, glow: 0.07, glowI: 0.45, halo: 0.16, haloW: 0.012, haloI: 0.22, rays: 14, rayI: 0.3, streak: 0, tint: [1, 0.86, 0.7],
    ghosts: [
      { t: 0.35, r: 0.02, c: [0.6, 1, 0.6], i: 0.12 },
      { t: 0.55, r: 0.035, c: [1, 0.7, 0.4], i: 0.1 },
      { t: 0.8, r: 0.012, c: [0.6, 0.8, 1], i: 0.18 },
      { t: 1.15, r: 0.05, c: [0.8, 0.6, 1], i: 0.07 },
      { t: 1.45, r: 0.025, c: [1, 0.9, 0.5], i: 0.1 },
      { t: 1.9, r: 0.075, c: [0.5, 0.7, 1], i: 0.06 },
    ],
  },
  wide: {
    core: 0.008, glow: 0.045, glowI: 0.35, halo: 0.1, haloW: 0.018, haloI: 0.35, rays: 24, rayI: 0.18, streak: 0, tint: [1, 0.95, 0.9],
    ghosts: Array.from({ length: 10 }, (_, k) => ({
      t: 0.2 + k * 0.19, r: 0.008 + ((k * 7) % 5) * 0.006, c: [[1, 0.6, 0.5], [0.5, 1, 0.7], [0.6, 0.7, 1]][k % 3] as [number, number, number], i: 0.1,
    })),
  },
  anamorphic: {
    core: 0.01, glow: 0.05, glowI: 0.35, halo: 0, haloW: 1, haloI: 0, rays: 0, rayI: 0, streak: 0.9, tint: [0.75, 0.85, 1],
    ghosts: [
      { t: 0.5, r: 0.03, c: [0.4, 0.6, 1], i: 0.12, sx: 1.8 },
      { t: 0.9, r: 0.018, c: [0.5, 0.8, 1], i: 0.15, sx: 1.8 },
      { t: 1.4, r: 0.05, c: [0.3, 0.5, 1], i: 0.08, sx: 1.8 },
    ],
  },
  soft: {
    core: 0.02, glow: 0.16, glowI: 0.7, halo: 0, haloW: 1, haloI: 0, rays: 0, rayI: 0, streak: 0, tint: [1, 0.85, 0.65],
    ghosts: [
      { t: 0.7, r: 0.06, c: [1, 0.8, 0.6], i: 0.05 },
      { t: 1.5, r: 0.1, c: [0.8, 0.8, 1], i: 0.04 },
    ],
  },
};
export const lensFlare = defineOp({
  id: 'lens-flare',
  label: 'Lens Flare',
  category: 'Render',
  params: [
    { key: 'brightness', label: 'Brightness', type: 'number', min: 10, max: 300, step: 1, default: 100, unit: '%' },
    { key: 'center', label: 'Flare Center', type: 'point', default: { x: 0.3, y: 0.3 } },
    {
      key: 'lens',
      label: 'Lens Type',
      type: 'select',
      options: [
        { value: 'classic', label: 'Classic' },
        { value: 'wide', label: 'Wide Angle' },
        { value: 'anamorphic', label: 'Anamorphic Streak' },
        { value: 'soft', label: 'Soft Glow' },
      ],
      default: 'classic',
    },
  ],
  run(src, p, ctx, progress) {
    const { width: w, height: h, data: d } = src;
    const st = STYLES[str(p, 'lens')] ?? STYLES.classic;
    const c = point(p, 'center'), fx = c.x * w, fy = c.y * h, mx = w / 2, my = h / 2;
    const D = Math.hypot(w, h), gain = num(p, 'brightness') / 100, seed = ctx.seed ?? 0;
    const ghosts = st.ghosts.map((g) => ({ ...g, x: fx + (mx - fx) * g.t, y: fy + (my - fy) * g.t, R: g.r * D }));
    const out = newImage(src), o = out.data;
    const core = st.core * D, glow = st.glow * D, halo = st.halo * D, haloW = st.haloW * D, rayLen = 0.3 * D;
    for (let y = 0; y < h; y++) {
      tick(progress, y, h);
      for (let x = 0; x < w; x++) {
        const dx = x + 0.5 - fx, dy = y + 0.5 - fy, dist = Math.hypot(dx, dy);
        const [tr, tg, tb] = st.tint;
        const c0 = 2 * Math.exp(-((dist / core) ** 2)), gl = st.glowI * Math.exp(-dist / glow);
        let r = c0 + gl * tr, g = c0 + gl * tg, b = c0 + gl * tb;
        if (st.haloI > 0) {
          const u = (dist - halo) / haloW;
          if (Math.abs(u) < 3) {
            const t = clamp(0.5 + u / 4, 0, 1) * 5, k = st.haloI * Math.exp(-u * u);
            // Rainbow across the ring, red outside to violet inside.
            r += k * clamp(Math.abs(t - 3) - 1, 0, 1); g += k * clamp(2 - Math.abs(t - 2), 0, 1); b += k * clamp(2 - Math.abs(t - 4), 0, 1);
          }
        }
        if (st.rays > 0 && dist > 0) {
          const th = Math.atan2(dy, dx), k = Math.floor(((th + Math.PI) / (2 * Math.PI)) * st.rays + 0.5);
          const jitter = rand(seed, k, 77);
          const ray = st.rayI * Math.abs(Math.cos((th * st.rays) / 2)) ** 40 * (0.5 + 0.5 * jitter) * Math.exp(-dist / (rayLen * (0.4 + jitter)));
          r += ray * tr; g += ray * tg; b += ray * tb;
        }
        if (st.streak > 0) {
          const k = st.streak * Math.exp(-Math.abs(dy) / (0.004 * D)) * Math.exp(-Math.abs(dx) / (0.35 * D));
          r += k * tr; g += k * tg; b += k * tb;
        }
        for (let q = 0; q < ghosts.length; q++) {
          const gh = ghosts[q];
          const gd = Math.hypot((x + 0.5 - gh.x) / (gh.sx ?? 1), y + 0.5 - gh.y) / gh.R;
          if (gd >= 1) continue;
          // Soft-edged disc with a slightly brighter rim.
          const k = gh.i * clamp((1 - gd) / 0.15, 0, 1) * (0.6 + 0.4 * gd);
          r += k * gh.c[0]; g += k * gh.c[1]; b += k * gh.c[2];
        }
        r = clamp(r * gain, 0, 1); g = clamp(g * gain, 0, 1); b = clamp(b * gain, 0, 1);
        // Screen over the source in premultiplied form; the flare's own
        // coverage is its brightest channel, so it also lights transparent areas.
        const j = (y * w + x) * 4, as = d[j + 3] / 255, af = Math.max(r, g, b);
        const A = as + af - as * af;
        if (A <= 0) { o[j] = d[j]; o[j + 1] = d[j + 1]; o[j + 2] = d[j + 2]; o[j + 3] = 0; continue; }
        const sr = (d[j] / 255) * as, sg = (d[j + 1] / 255) * as, sb = (d[j + 2] / 255) * as;
        o[j] = ((sr + r - sr * r) / A) * 255;
        o[j + 1] = ((sg + g - sg * g) / A) * 255;
        o[j + 2] = ((sb + b - sb * b) / A) * 255;
        o[j + 3] = A * 255;
      }
    }
    return out;
  },
});

// ---------------------------------------------------------------------------
// Lighting: Lambert diffuse plus Blinn-Phong specular over a height field
// taken from one channel.

export const lightingEffects = defineOp({
  id: 'lighting-effects',
  label: 'Lighting Effects',
  category: 'Render',
  params: [
    {
      key: 'type',
      label: 'Light Type',
      type: 'select',
      options: [{ value: 'spot', label: 'Spot' }, { value: 'point', label: 'Point' }, { value: 'infinite', label: 'Infinite' }],
      default: 'spot',
    },
    { key: 'color', label: 'Light Color', type: 'color', default: '#ffffff' },
    { key: 'intensity', label: 'Intensity', type: 'number', min: 0, max: 200, step: 1, default: 100, unit: '%' },
    { key: 'ambient', label: 'Ambience', type: 'number', min: 0, max: 100, step: 1, default: 20, unit: '%' },
    { key: 'position', label: 'Light Position', type: 'point', default: { x: 0.3, y: 0.3 } },
    { key: 'height', label: 'Light Height', type: 'number', min: 1, max: 100, step: 1, default: 30, unit: '%' },
    { key: 'angle', label: 'Direction', type: 'number', min: -180, max: 180, step: 1, default: -45, unit: '°' },
    { key: 'elevation', label: 'Elevation', type: 'number', min: 0, max: 90, step: 1, default: 45, unit: '°' },
    { key: 'cone', label: 'Spot Cone', type: 'number', min: 5, max: 90, step: 1, default: 35, unit: '°' },
    {
      key: 'bump',
      label: 'Texture Channel',
      type: 'select',
      options: [
        { value: 'none', label: 'None' },
        { value: 'luminance', label: 'Luminance' },
        { value: 'red', label: 'Red' },
        { value: 'green', label: 'Green' },
        { value: 'blue', label: 'Blue' },
        { value: 'alpha', label: 'Transparency' },
      ],
      default: 'none',
    },
    { key: 'bumpHeight', label: 'Texture Height', type: 'number', min: 0, max: 100, step: 1, default: 20 },
    { key: 'gloss', label: 'Gloss', type: 'number', min: 0, max: 100, step: 1, default: 20, unit: '%' },
  ],
  run(src, p, ctx, progress) {
    const { width: w, height: h, data: d } = src;
    const n = w * h, s = ctx.scale ?? 1, M = Math.max(w, h);
    const type = str(p, 'type'), [lr, lg, lb] = hexColor(str(p, 'color')).map((v) => v / 255);
    const I = num(p, 'intensity') / 100, amb = num(p, 'ambient') / 100, gloss = num(p, 'gloss') / 100;
    const pos = point(p, 'position'), Lx = pos.x * w, Ly = pos.y * h, Lz = (num(p, 'height') / 100) * M;
    const az = (num(p, 'angle') * Math.PI) / 180, el = (num(p, 'elevation') * Math.PI) / 180;
    const cosCone = Math.cos((num(p, 'cone') * Math.PI) / 180);
    // Spot axis aims at a ground point along the direction from the light.
    let ax = Lx + Math.cos(az) * 0.35 * M - Lx, ay = Ly - Math.sin(az) * 0.35 * M - Ly, azz = -Lz;
    const al = Math.hypot(ax, ay, azz);
    ax /= al; ay /= al; azz /= al;
    const ix = Math.cos(el) * Math.cos(az), iy = -Math.cos(el) * Math.sin(az), iz = Math.sin(el);
    const bump = str(p, 'bump');
    const H = new Float32Array(n);
    if (bump !== 'none') {
      const k = ((num(p, 'bumpHeight') / 100) * 10 * s) / 255;
      if (bump === 'luminance') lumaPlane(src, H);
      else { const c = { red: 0, green: 1, blue: 2, alpha: 3 }[bump] ?? 0; for (let i = 0; i < n; i++) H[i] = d[i * 4 + c]; }
      for (let i = 0; i < n; i++) H[i] *= k;
    }
    const sharp = 4 + gloss * 120;
    const out = newImage(src), o = out.data;
    for (let y = 0; y < h; y++) {
      tick(progress, y, h);
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const hx = (H[y * w + Math.min(w - 1, x + 1)] - H[y * w + Math.max(0, x - 1)]) / 2;
        const hy = (H[Math.min(h - 1, y + 1) * w + x] - H[Math.max(0, y - 1) * w + x]) / 2;
        let nx = -hx, ny = -hy, nz = 1;
        const nl = Math.hypot(nx, ny, nz);
        nx /= nl; ny /= nl; nz /= nl;
        let lx: number, ly: number, lz: number, att = 1;
        if (type === 'infinite') { lx = ix; ly = iy; lz = iz; }
        else {
          lx = Lx - x; ly = Ly - y; lz = Lz - H[i];
          const dist = Math.hypot(lx, ly, lz);
          lx /= dist; ly /= dist; lz /= dist;
          att = 1.4 / (1 + (dist / (0.9 * M)) ** 2);
          if (type === 'spot') {
            const cosA = -(lx * ax + ly * ay + lz * azz);
            att *= Math.sqrt(clamp((cosA - cosCone) / (1 - cosCone), 0, 1));
          }
        }
        const diff = Math.max(0, nx * lx + ny * ly + nz * lz) * att * I;
        let spec = 0;
        if (gloss > 0 && diff > 0) {
          let hx2 = lx, hy2 = ly, hz2 = lz + 1;
          const hl = Math.hypot(hx2, hy2, hz2);
          hx2 /= hl; hy2 /= hl; hz2 /= hl;
          spec = gloss * Math.max(0, nx * hx2 + ny * hy2 + nz * hz2) ** sharp * att * I;
        }
        const j = i * 4;
        o[j] = d[j] * (amb + diff * lr) + 255 * spec * lr;
        o[j + 1] = d[j + 1] * (amb + diff * lg) + 255 * spec * lg;
        o[j + 2] = d[j + 2] * (amb + diff * lb) + 255 * spec * lb;
        o[j + 3] = d[j + 3];
      }
    }
    return out;
  },
});

