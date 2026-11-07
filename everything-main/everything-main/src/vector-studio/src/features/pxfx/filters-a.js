/**
 * Pixel filters, part one: Artistic, Blur, Brush Strokes and Distort.
 *
 * Every filter is run(img, p, ctx) -> img. Lengths in parameters are
 * document units (points); ctx.k is work pixels per point, ctx.ox/oy the
 * work image's place on the document pixel grid (patterns use document
 * coordinates, so they stay put when the view moves), ctx.seed the
 * effect's random seed and ctx.bounds the object's bounds in work pixels.
 */
import {
  clamp01,
  smoothstep,
  lerp,
  createImg,
  likeImg,
  cloneImg,
  hexRgb,
  lum,
  gauss,
  blurImg,
  blurColor,
  sharpen,
  sobel,
  sample,
  sampleZero,
  displace,
  dirBlur,
  kuwahara,
  hash2,
  noise2,
  fbm,
  docX,
  docY,
  field,
  mapColor,
} from './img.js';
import { P, S, C, B } from './params.js';

const px = (ctx, v, min = 0) => Math.max(min, v * ctx.k);

// ---- Artistic ----

const coloredPencil = {
  id: 'coloredPencil',
  label: 'Colored Pencil',
  category: 'artistic',
  params: [P('width', 'Pencil Width', 1, 24, 4, { unit: 'pt' }), P('pressure', 'Stroke Pressure', 0, 15, 8), P('paper', 'Paper Brightness', 0, 50, 25)],
  reach: () => 3,
  run(img, p, ctx) {
    const L = lum(img);
    const E = sobel(gauss(L, img.w, img.h, px(ctx, 0.8)), img.w, img.h).mag;
    const paper = 0.5 + p.paper / 100;
    const press = 0.55 + p.pressure / 15;
    const wid = Math.max(0.5, p.width * 0.5);
    const out = likeImg(img);
    let i = 0;
    for (let y = 0; y < img.h; y++) {
      const Y = docY(ctx, y);
      for (let x = 0; x < img.w; x++, i++) {
        const X = docX(ctx, x);
        const a = (X + Y) * Math.SQRT1_2;
        const b = (X - Y) * Math.SQRT1_2;
        // Long strokes along one diagonal, a crossing set for the darkest areas.
        const s1 = noise2(b / wid, a / (wid * 7), ctx.seed);
        const s2 = noise2(a / wid, b / (wid * 7), ctx.seed + 3);
        const dark = 1 - L[i];
        const cover = clamp01(dark * press + E[i] * 6);
        let m = smoothstep(1 - cover - 0.12, 1 - cover + 0.12, s1);
        if (dark > 0.55) m = Math.max(m, smoothstep(1.55 - cover - 0.12, 1.55 - cover + 0.12, s2));
        const k = 0.92;
        out.r[i] = lerp(paper, img.r[i] * k, m);
        out.g[i] = lerp(paper, img.g[i] * k, m);
        out.b[i] = lerp(paper, img.b[i] * k, m);
      }
    }
    return out;
  },
};

const cutout = {
  id: 'cutout',
  label: 'Cutout',
  category: 'artistic',
  params: [P('levels', 'Number of Levels', 2, 8, 4), P('simplicity', 'Edge Simplicity', 0, 10, 4), P('fidelity', 'Edge Fidelity', 1, 3, 2)],
  reach: (p) => p.simplicity * 1.5 + 2,
  run(img, p, ctx) {
    const sigma = px(ctx, p.simplicity * 0.5 + (3 - p.fidelity) * 0.4);
    const B0 = blurColor(img, sigma);
    const n = Math.round(p.levels);
    // Fixed bins (not a palette of the visible part), so every view and tile agrees.
    return mapColor(B0, (r, g, b) => {
      const [hh, ss, ll] = rgbToHsl(r, g, b);
      const l = (Math.min(n - 1, Math.floor(ll * n)) + 0.5) / n;
      const sq = Math.min(2, Math.floor(ss * 3));
      const s2 = sq === 0 ? 0 : sq === 1 ? 0.45 : 0.8;
      const h2 = (Math.round(hh * 12) % 12) / 12;
      return hslToRgb(h2, s2, l);
    });
  },
};

function rgbToHsl(r, g, b) {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h;
  if (mx === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (mx === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h / 6, s, l];
}

function hslToRgb(h, s, l) {
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t) => {
    t = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)];
}

const dryBrush = {
  id: 'dryBrush',
  label: 'Dry Brush',
  category: 'artistic',
  params: [P('size', 'Brush Size', 0, 10, 2, { unit: 'pt' }), P('detail', 'Brush Detail', 0, 10, 8), P('texture', 'Texture', 1, 3, 1)],
  reach: (p) => p.size * 1.5 + 3,
  run(img, p, ctx) {
    const r = Math.min(40, Math.max(1, Math.round(px(ctx, (p.size + 1) * 0.8))));
    let out = kuwahara(img, r);
    out = sharpen(out, Math.max(1, r * 0.6), p.detail / 12);
    const levels = 5 + p.detail;
    const tex = ((p.texture - 1) / 2) * 0.22 + 0.04;
    const len = Math.max(1, p.size + 2);
    const nz = field(img, ctx, (X, Y) => noise2((X - Y) * 0.7, (X + Y) / (len * 2.5), ctx.seed) - 0.5);
    return mapColor(out, (r0, g0, b0, i) => {
      const t = nz[i] * tex;
      return [Math.round((r0 + t) * levels) / levels, Math.round((g0 + t) * levels) / levels, Math.round((b0 + t) * levels) / levels];
    });
  },
};

const filmGrain = {
  id: 'filmGrain',
  label: 'Film Grain',
  category: 'artistic',
  params: [P('grain', 'Grain', 0, 20, 4), P('highlight', 'Highlight Area', 0, 20, 0), P('intensity', 'Intensity', 0, 10, 10)],
  run(img, p, ctx) {
    const L = lum(img);
    const amp = (p.grain / 20) * 0.45;
    const thr = 1 - (p.highlight / 20) * 0.7;
    const glow = blurImg({ ...img, r: L, g: L, b: L }, px(ctx, 2)).r;
    const out = likeImg(img);
    let i = 0;
    for (let y = 0; y < img.h; y++) {
      for (let x = 0; x < img.w; x++, i++) {
        const gx = x + ctx.ox;
        const gy = y + ctx.oy;
        const n = hash2(gx, gy, ctx.seed) + hash2(gx, gy, ctx.seed + 1) - 1;
        const g = n * amp * (1 - Math.abs(2 * L[i] - 1) * 0.6);
        const hl = p.highlight > 0 ? smoothstep(thr, thr + 0.2, glow[i]) * (p.intensity / 10) * 0.7 : 0;
        out.r[i] = clamp01(lerp(img.r[i] + g, 1, hl));
        out.g[i] = clamp01(lerp(img.g[i] + g, 1, hl));
        out.b[i] = clamp01(lerp(img.b[i] + g, 1, hl));
      }
    }
    return out;
  },
};

const neonGlow = {
  id: 'neonGlow',
  label: 'Neon Glow',
  category: 'artistic',
  params: [P('size', 'Glow Size', -24, 24, 5, { unit: 'pt' }), P('brightness', 'Glow Brightness', 0, 50, 15), C('color', 'Glow Color', '#3d8cff')],
  reach: (p) => Math.abs(p.size) * 1.5 + 2,
  run(img, p, ctx) {
    const L = lum(img);
    const mask = L.map((v) => smoothstep(0.35, 0.95, p.size >= 0 ? v : 1 - v));
    const glow = gauss(mask, img.w, img.h, px(ctx, Math.abs(p.size) * 0.5 + 0.5));
    const [cr, cg, cb] = hexRgb(p.color);
    const gain = p.brightness / 12;
    return mapColor(img, (r, g, b, i) => {
      const base = L[i] * 0.55;
      const t = clamp01(glow[i] * gain);
      return [1 - (1 - base) * (1 - cr * t), 1 - (1 - base) * (1 - cg * t), 1 - (1 - base) * (1 - cb * t)];
    });
  },
};

const DAUB_TYPES = [
  { value: 'simple', label: 'Simple' },
  { value: 'lightRough', label: 'Light Rough' },
  { value: 'darkRough', label: 'Dark Rough' },
  { value: 'wideSharp', label: 'Wide Sharp' },
  { value: 'wideBlurry', label: 'Wide Blurry' },
  { value: 'sparkle', label: 'Sparkle' },
];

const paintDaubs = {
  id: 'paintDaubs',
  label: 'Paint Daubs',
  category: 'artistic',
  params: [P('size', 'Brush Size', 1, 50, 8, { unit: 'pt' }), P('sharpness', 'Sharpness', 0, 40, 7), S('brush', 'Brush Type', DAUB_TYPES, 'simple')],
  reach: (p) => p.size * 0.7 + 2,
  run(img, p, ctx) {
    const wide = p.brush === 'wideSharp' || p.brush === 'wideBlurry';
    const r = Math.min(40, Math.max(1, Math.round(px(ctx, p.size * (wide ? 0.8 : 0.5)))));
    let out = kuwahara(img, r);
    let amount = p.sharpness / 10;
    if (p.brush === 'wideSharp') amount *= 1.6;
    out = sharpen(out, Math.max(1, r * 0.5), amount);
    if (p.brush === 'wideBlurry') out = blurColor(out, Math.max(0.8, r * 0.25));
    if (p.brush === 'simple' || p.brush === 'wideSharp' || p.brush === 'wideBlurry') return out;
    const L = lum(out);
    const E = p.brush === 'darkRough' ? sobel(L, img.w, img.h).mag : null;
    return mapColor(out, (r0, g0, b0, i) => {
      const x = i % img.w;
      const y = (i / img.w) | 0;
      const n = hash2(x + ctx.ox, y + ctx.oy, ctx.seed);
      if (p.brush === 'lightRough') {
        const t = (n - 0.3) * 0.18;
        return [r0 + t, g0 + t, b0 + t];
      }
      if (p.brush === 'darkRough') {
        const d = 1 - clamp01(E[i] * 5) * 0.6 - (n < 0.25 ? 0.12 : 0);
        return [r0 * d, g0 * d, b0 * d];
      }
      // Sparkle: bright specks in the lighter areas.
      const s = n > 0.985 - L[i] * 0.03 ? 0.5 : 0;
      return [r0 + s, g0 + s, b0 + s];
    });
  },
};

const plasticWrap = {
  id: 'plasticWrap',
  label: 'Plastic Wrap',
  category: 'artistic',
  params: [P('strength', 'Highlight Strength', 0, 20, 15), P('detail', 'Detail', 1, 15, 9), P('smoothness', 'Smoothness', 1, 15, 7)],
  reach: (p) => p.smoothness + 3,
  run(img, p, ctx) {
    const H = gauss(lum(img), img.w, img.h, px(ctx, p.smoothness * 0.45 + 0.6));
    const { gx, gy } = sobel(H, img.w, img.h);
    const s = ctx.k * (6 + p.detail * 3);
    const shin = 6 + p.detail * 2;
    // Light from the upper left; viewer straight on.
    const lx = -0.45;
    const ly = -0.55;
    const lz = 0.7;
    return mapColor(img, (r, g, b, i) => {
      const nx = -gx[i] * s;
      const ny = -gy[i] * s;
      const len = Math.sqrt(nx * nx + ny * ny + 1);
      const hx = lx;
      const hy = ly;
      const hz = lz + 1;
      const hl = Math.sqrt(hx * hx + hy * hy + hz * hz);
      const spec = Math.max(0, (nx * hx + ny * hy + hz) / (len * hl)) ** shin;
      const v = spec * (p.strength / 20);
      return [r * 0.9 + v, g * 0.9 + v, b * 0.9 + v];
    });
  },
};

const posterEdges = {
  id: 'posterEdges',
  label: 'Poster Edges',
  category: 'artistic',
  params: [P('thickness', 'Edge Thickness', 0, 10, 2), P('intensity', 'Edge Intensity', 0, 10, 1), P('levels', 'Posterization', 0, 6, 2)],
  reach: (p) => p.thickness + 2,
  run(img, p, ctx) {
    const B0 = blurColor(img, px(ctx, 0.6));
    const E = gauss(sobel(lum(B0), img.w, img.h).mag, img.w, img.h, px(ctx, p.thickness * 0.25));
    const n = p.levels + 2;
    const gain = (p.intensity + 1) * 3;
    return mapColor(img, (r, g, b, i) => {
      const d = 1 - clamp01(E[i] * gain - 0.15);
      return [(Math.round(r * (n - 1)) / (n - 1)) * d, (Math.round(g * (n - 1)) / (n - 1)) * d, (Math.round(b * (n - 1)) / (n - 1)) * d];
    });
  },
};

const sponge = {
  id: 'sponge',
  label: 'Sponge',
  category: 'artistic',
  params: [P('size', 'Brush Size', 0, 10, 2, { unit: 'pt' }), P('definition', 'Definition', 0, 25, 12), P('smoothness', 'Smoothness', 1, 15, 5)],
  reach: (p) => p.smoothness * 0.5 + 2,
  run(img, p, ctx) {
    const sc = p.size * 0.8 + 1.2;
    const tex = field(img, ctx, (X, Y) => fbm(X / sc, Y / sc, ctx.seed, 3));
    const t = gauss(tex, img.w, img.h, px(ctx, p.smoothness * 0.12));
    const def = p.definition / 25;
    return mapColor(img, (r, g, b, i) => {
      const hole = smoothstep(0.42, 0.62, t[i]);
      const d = 1 - hole * def * 0.65;
      const c = (v) => lerp(v, v * v * (3 - 2 * v), def) * d + (1 - hole) * def * 0.08;
      return [c(r), c(g), c(b)];
    });
  },
};

const watercolor = {
  id: 'watercolor',
  label: 'Watercolor',
  category: 'artistic',
  params: [P('detail', 'Brush Detail', 1, 14, 9), P('shadow', 'Shadow Intensity', 0, 10, 1), P('texture', 'Texture', 1, 3, 1)],
  reach: (p) => (15 - p.detail) * 0.4 + 4,
  run(img, p, ctx) {
    const r = Math.min(30, Math.max(1, Math.round(px(ctx, (15 - p.detail) * 0.3 + 0.5))));
    const K = blurColor(kuwahara(img, r), px(ctx, 0.5));
    const L = lum(K);
    const D = gauss(L, img.w, img.h, px(ctx, 2));
    const gam = 1 + p.shadow * 0.14;
    const tex = (p.texture - 1) * 0.05 + 0.02;
    const paper = field(img, ctx, (X, Y) => fbm(X / 3, Y / 3, ctx.seed, 3));
    return mapColor(K, (r0, g0, b0, i) => {
      // Pigment pools at the dark side of edges; colors are a little richer.
      const edge = 1 + Math.min(0, L[i] - D[i]) * 3.5;
      const m = (r0 + g0 + b0) / 3;
      const sat = (v) => m + (v - m) * 1.25;
      const t = 1 - (paper[i] - 0.5) * tex * 2;
      const f = (v) => clamp01(sat(v)) ** gam * edge * t;
      return [f(r0), f(g0), f(b0)];
    });
  },
};

// ---- Blur ----

const radialBlur = {
  id: 'radialBlur',
  label: 'Radial Blur',
  category: 'blur',
  params: [
    P('amount', 'Amount', 1, 100, 10),
    S('method', 'Blur Method', [{ value: 'spin', label: 'Spin' }, { value: 'zoom', label: 'Zoom' }], 'spin'),
    S('quality', 'Quality', [{ value: 'draft', label: 'Draft' }, { value: 'good', label: 'Good' }, { value: 'best', label: 'Best' }], 'good'),
    P('cx', 'Center X', 0, 100, 50, { unit: '%' }),
    P('cy', 'Center Y', 0, 100, 50, { unit: '%' }),
  ],
  // Zoom pulls the artwork outward; spin swings the corners around.
  grow(p, b) {
    if (!b) return 0;
    const half = Math.hypot(b.w, b.h) / 2;
    if (p.method === 'zoom') {
      const s = (p.amount / 100) * 0.6;
      return Math.min(half * 4, (half * s) / (1 - s));
    }
    return Math.max(0, half - Math.min(b.w, b.h) / 2) * Math.min(1, p.amount / 40);
  },
  reach: () => 0,
  run(img, p, ctx) {
    const { w, h } = img;
    const bd = ctx.bounds || { x: 0, y: 0, w, h };
    const cx = bd.x + (bd.w * p.cx) / 100;
    const cy = bd.y + (bd.h * p.cy) / 100;
    const cap = { draft: 8, good: 20, best: 40 }[p.quality] || 20;
    const out = createImg(w, h);
    const pr = new Float32Array(w * h);
    const pg = new Float32Array(w * h);
    const pb = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) {
      pr[i] = img.r[i] * img.a[i];
      pg[i] = img.g[i] * img.a[i];
      pb[i] = img.b[i] * img.a[i];
    }
    const spin = p.method !== 'zoom';
    const ang = (p.amount / 100) * (Math.PI / 3);
    const zs = (p.amount / 100) * 0.6;
    let i = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++, i++) {
        const dx = x - cx;
        const dy = y - cy;
        const rad = Math.hypot(dx, dy);
        const len = spin ? rad * ang : rad * zs;
        const n = Math.max(1, Math.min(cap, Math.ceil(len)));
        let r = 0;
        let g = 0;
        let b = 0;
        let a = 0;
        for (let s = 0; s <= n; s++) {
          const t = n ? s / n : 0;
          let sx;
          let sy;
          if (spin) {
            const th = (t - 0.5) * ang;
            const c = Math.cos(th);
            const si = Math.sin(th);
            sx = cx + dx * c - dy * si;
            sy = cy + dx * si + dy * c;
          } else {
            const f = 1 - t * zs;
            sx = cx + dx * f;
            sy = cy + dy * f;
          }
          r += sampleZero(pr, w, h, sx, sy);
          g += sampleZero(pg, w, h, sx, sy);
          b += sampleZero(pb, w, h, sx, sy);
          a += sampleZero(img.a, w, h, sx, sy);
        }
        const m = n + 1;
        out.a[i] = a / m;
        if (a > 1e-6) {
          out.r[i] = r / a;
          out.g[i] = g / a;
          out.b[i] = b / a;
        } else {
          out.r[i] = img.r[i];
          out.g[i] = img.g[i];
          out.b[i] = img.b[i];
        }
      }
    }
    return out;
  },
};

const smartBlur = {
  id: 'smartBlur',
  label: 'Smart Blur',
  category: 'blur',
  params: [
    P('radius', 'Radius', 0.1, 100, 3, { step: 0.1, unit: 'pt' }),
    P('threshold', 'Threshold', 0.1, 100, 25, { step: 0.1 }),
    S('quality', 'Quality', [{ value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }], 'medium'),
    S('mode', 'Mode', [{ value: 'normal', label: 'Normal' }, { value: 'edgeOnly', label: 'Edge Only' }, { value: 'overlay', label: 'Overlay Edge' }], 'normal'),
  ],
  reach: (p) => Math.min(100, p.radius) + 1,
  run(img, p, ctx) {
    const { w, h } = img;
    const t = (p.threshold / 100) * 0.6;
    if (p.mode !== 'normal') {
      const E = sobel(lum(blurColor(img, px(ctx, 0.4))), w, h).mag;
      const thr = Math.max(0.004, t * 0.25);
      return mapColor(img, (r, g, b, i) => {
        const e = smoothstep(thr, thr * 1.6, E[i]);
        return p.mode === 'edgeOnly' ? [e, e, e] : [lerp(r, 1, e), lerp(g, 1, e), lerp(b, 1, e)];
      });
    }
    const R = Math.min(48, Math.max(1, Math.round(px(ctx, p.radius))));
    const step = { low: 3, medium: 2, high: 1 }[p.quality] || 2;
    const pass = (src, horizontal) => {
      const L = lum(src);
      const out = likeImg(src);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          const l0 = L[i];
          let r = 0;
          let g = 0;
          let b = 0;
          let n = 0;
          for (let d = -Math.floor(R / step) * step; d <= R; d += step) {
            const xx = horizontal ? x + d : x;
            const yy = horizontal ? y : y + d;
            if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
            const j = yy * w + xx;
            if (Math.abs(L[j] - l0) > t) continue;
            const q = img.a[j] + 1e-3;
            r += src.r[j] * q;
            g += src.g[j] * q;
            b += src.b[j] * q;
            n += q;
          }
          out.r[i] = r / n;
          out.g[i] = g / n;
          out.b[i] = b / n;
        }
      }
      return out;
    };
    return pass(pass(img, true), false);
  },
};

// ---- Brush Strokes ----

const accentedEdges = {
  id: 'accentedEdges',
  label: 'Accented Edges',
  category: 'strokes',
  params: [P('width', 'Edge Width', 1, 14, 2), P('brightness', 'Edge Brightness', 0, 50, 38), P('smoothness', 'Smoothness', 1, 15, 5)],
  reach: (p) => p.smoothness * 0.3 + p.width * 0.5 + 3,
  run(img, p, ctx) {
    const Sm = blurColor(dirBlur(img, 1, 1, px(ctx, 1.5)), px(ctx, p.smoothness * 0.12));
    const E = gauss(sobel(lum(Sm), img.w, img.h).mag, img.w, img.h, px(ctx, p.width * 0.2));
    const up = p.brightness >= 25;
    const amt = Math.abs(p.brightness - 25) / 25;
    return mapColor(Sm, (r, g, b, i) => {
      const e = clamp01(E[i] * 5) * amt;
      const to = up ? 1 : 0;
      return [lerp(r, to, e), lerp(g, to, e), lerp(b, to, e)];
    });
  },
};

const crosshatch = {
  id: 'crosshatch',
  label: 'Crosshatch',
  category: 'strokes',
  params: [P('length', 'Stroke Length', 3, 50, 9, { unit: 'pt' }), P('sharpness', 'Sharpness', 0, 20, 6), P('strength', 'Strength', 1, 3, 1)],
  reach: (p) => p.length * 0.5 + 2,
  run(img, p, ctx) {
    const len = px(ctx, p.length * 0.5);
    const A = dirBlur(img, 1, 1, len);
    const Bm = dirBlur(img, 1, -1, len);
    const pick = field(img, ctx, (X, Y) => noise2((X + Y) / p.length, (X - Y) / p.length, ctx.seed));
    let out = mapColor(A, (r, g, b, i) => {
      const t = smoothstep(0.4, 0.6, pick[i]);
      return [lerp(r, Bm.r[i], t), lerp(g, Bm.g[i], t), lerp(b, Bm.b[i], t)];
    });
    out = sharpen(out, Math.max(1, px(ctx, 1)), p.sharpness / 8);
    const L = lum(out);
    const per = 2.4;
    const hatch = field(img, ctx, (X, Y) => {
      const u = 0.5 + 0.5 * Math.sin(((X + Y) * Math.PI * 2) / per);
      const v = 0.5 + 0.5 * Math.sin(((X - Y) * Math.PI * 2) / per);
      return Math.max(u, v);
    });
    const str = p.strength / 3;
    return mapColor(out, (r, g, b, i) => {
      const d = 1 - L[i];
      const m = smoothstep(1 - d * 0.9, 1.05 - d * 0.9, hatch[i]) * str * 0.45;
      return [r * (1 - m), g * (1 - m), b * (1 - m)];
    });
  },
};

const inkOutlines = {
  id: 'inkOutlines',
  label: 'Ink Outlines',
  category: 'strokes',
  params: [P('length', 'Stroke Length', 1, 50, 4, { unit: 'pt' }), P('dark', 'Dark Intensity', 0, 50, 20), P('light', 'Light Intensity', 0, 50, 10)],
  reach: (p) => p.length * 0.4 + 2,
  run(img, p, ctx) {
    const A = dirBlur(img, 1, -1, px(ctx, p.length * 0.4));
    const L = lum(A);
    const E = sobel(gauss(L, img.w, img.h, px(ctx, 0.4)), img.w, img.h).mag;
    const dk = p.dark / 50;
    const lt = p.light / 50;
    return mapColor(A, (r, g, b, i) => {
      const ink = clamp01(E[i] * 7);
      const d = (1 - ink * (0.35 + dk * 0.65)) * (1 - (1 - L[i]) * dk * 0.5);
      const l = L[i] * L[i] * lt * 0.6;
      return [lerp(r * d, 1, l), lerp(g * d, 1, l), lerp(b * d, 1, l)];
    });
  },
};

const spatter = {
  id: 'spatter',
  label: 'Spatter',
  category: 'strokes',
  params: [P('radius', 'Spray Radius', 0, 25, 10, { unit: 'pt' }), P('smoothness', 'Smoothness', 1, 15, 5)],
  grow: (p) => p.radius * 0.5,
  reach: (p) => p.radius * 0.5 + 1,
  run(img, p, ctx) {
    const R = px(ctx, p.radius * 0.5);
    if (R < 0.5) return cloneImg(img);
    const sm = (p.smoothness - 1) / 14;
    const sc = 0.6 + p.smoothness * 0.3;
    return displace(img, (x, y) => {
      const gx = x + ctx.ox;
      const gy = y + ctx.oy;
      const X = docX(ctx, x);
      const Y = docY(ctx, y);
      const jx = lerp(hash2(gx, gy, ctx.seed), noise2(X / sc, Y / sc, ctx.seed + 5), sm) - 0.5;
      const jy = lerp(hash2(gx, gy, ctx.seed + 1), noise2(X / sc, Y / sc, ctx.seed + 9), sm) - 0.5;
      return [Math.round(x + jx * 2 * R), Math.round(y + jy * 2 * R)];
    });
  },
};

// ---- Distort ----

const diffuseGlow = {
  id: 'diffuseGlow',
  label: 'Diffuse Glow',
  category: 'distort',
  params: [P('grain', 'Graininess', 0, 10, 6), P('glow', 'Glow Amount', 0, 20, 10), P('clear', 'Clear Amount', 0, 20, 15), C('color', 'Glow Color', '#ffffff')],
  reach: () => 6,
  run(img, p, ctx) {
    const L = lum(img);
    const thr = 0.25 + (p.clear / 20) * 0.6;
    const m = L.map((v) => smoothstep(thr - 0.25, thr + 0.15, v));
    const G = gauss(m, img.w, img.h, px(ctx, 2.5));
    const [cr, cg, cb] = hexRgb(p.color);
    const amt = p.glow / 10;
    const gr = (p.grain / 10) * 0.6;
    return mapColor(img, (r, g, b, i) => {
      const x = i % img.w;
      const y = (i / img.w) | 0;
      const t = clamp01(G[i] * amt * 0.8);
      const sp = hash2(x + ctx.ox, y + ctx.oy, ctx.seed) < gr * t ? 1 : 0;
      const u = clamp01(t + sp * 0.6);
      return [lerp(r, cr, u), lerp(g, cg, u), lerp(b, cb, u)];
    });
  },
};

const GLASS_TEXTURES = [
  { value: 'blocks', label: 'Blocks' },
  { value: 'frosted', label: 'Frosted' },
  { value: 'tinyLens', label: 'Tiny Lens' },
  { value: 'canvas', label: 'Canvas' },
];

/** Height (0..1) of the glass surface at a document point. */
function glassHeight(type, X, Y, s, seed) {
  if (type === 'blocks') {
    const c = 12 * s;
    const fx = X / c - Math.floor(X / c);
    const fy = Y / c - Math.floor(Y / c);
    return Math.min(fx, 1 - fx, fy, 1 - fy) * 2;
  }
  if (type === 'tinyLens') {
    const c = 6 * s;
    const fx = X / c - Math.floor(X / c) - 0.5;
    const fy = Y / c - Math.floor(Y / c) - 0.5;
    const d = Math.min(1, Math.sqrt(fx * fx + fy * fy) * 2);
    return Math.sqrt(1 - d * d);
  }
  if (type === 'canvas') {
    const c = 2.5 * s;
    const u = Math.sin((X / c) * Math.PI);
    const v = Math.sin((Y / c) * Math.PI);
    return 0.5 + 0.25 * (u * Math.sign(v) + v * Math.sign(u));
  }
  return fbm(X / (2.5 * s), Y / (2.5 * s), seed, 3);
}

const glass = {
  id: 'glass',
  label: 'Glass',
  category: 'distort',
  params: [
    P('distortion', 'Distortion', 0, 20, 5),
    P('smoothness', 'Smoothness', 1, 15, 3),
    S('texture', 'Texture', GLASS_TEXTURES, 'frosted'),
    P('scaling', 'Scaling', 50, 200, 100, { unit: '%' }),
    B('invert', 'Invert', false),
  ],
  grow: (p) => p.distortion * 0.5,
  reach: (p) => p.distortion * 0.5 + p.smoothness * 0.3 + 1,
  run(img, p, ctx) {
    const s = p.scaling / 100;
    let H = field(img, ctx, (X, Y) => glassHeight(p.texture, X, Y, s, ctx.seed));
    if (p.invert) H = H.map((v) => 1 - v);
    H = gauss(H, img.w, img.h, px(ctx, p.smoothness * 0.2));
    const { gx, gy } = sobel(H, img.w, img.h);
    const amt = p.distortion * ctx.k * ctx.k * 12;
    const lim = px(ctx, p.distortion * 0.5);
    const cl = (v) => Math.max(-lim, Math.min(lim, v));
    return displace(img, (x, y) => {
      const i = y * img.w + x;
      return [x - cl(gx[i] * amt), y - cl(gy[i] * amt)];
    });
  },
};

const oceanRipple = {
  id: 'oceanRipple',
  label: 'Ocean Ripple',
  category: 'distort',
  params: [P('size', 'Ripple Size', 1, 15, 9), P('magnitude', 'Ripple Magnitude', 0, 20, 9)],
  grow: (p) => p.magnitude * 0.35,
  reach: (p) => p.magnitude * 0.35 + 1,
  run(img, p, ctx) {
    const sc = p.size * 0.6 + 1.2;
    const mag = px(ctx, p.magnitude * 0.35);
    return displace(img, (x, y) => {
      const X = docX(ctx, x);
      const Y = docY(ctx, y);
      const n1 = noise2(X / sc, Y / sc, ctx.seed) - 0.5;
      const n2 = noise2(X / sc + 17.3, Y / sc - 4.1, ctx.seed + 3) - 0.5;
      const wv = Math.sin(((X + Y * 0.6) / sc) * Math.PI * 1.3 + n1 * 4);
      return [x + (n1 * 1.4 + wv * 0.3) * mag, y + (n2 * 1.4 + wv * 0.3) * mag];
    });
  },
};

export const FILTERS_A = [
  coloredPencil,
  cutout,
  dryBrush,
  filmGrain,
  neonGlow,
  paintDaubs,
  plasticWrap,
  posterEdges,
  sponge,
  watercolor,
  radialBlur,
  smartBlur,
  accentedEdges,
  crosshatch,
  inkOutlines,
  spatter,
  diffuseGlow,
  glass,
  oceanRipple,
];

