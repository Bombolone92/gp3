/**
 * Pixel filters, part two: Pixelate, Sketch, Stylize and Texture (see
 * filters-a.js for the conventions). Sketch filters draw with an ink and a
 * paper color.
 */
import {
  clamp01,
  smoothstep,
  lerp,
  createImg,
  likeImg,
  hexRgb,
  lum,
  gauss,
  blurColor,
  sobel,
  sample,
  hash2,
  noise2,
  fbm,
  docX,
  docY,
  field,
  cells,
  siteColors,
  mapColor,
  inkPaper,
  shade,
  lightVec,
  LIGHT_DIRS,
} from './img.js';
import { P, S, C, B } from './params.js';

const px = (ctx, v, min = 0) => Math.max(min, v * ctx.k);
const INK = () => [C('ink', 'Ink Color', '#1a1a1a'), C('paper', 'Paper Color', '#ffffff')];
const LIGHTS = LIGHT_DIRS.map(({ value, label }) => ({ value, label }));

// ---- Pixelate ----

const colorHalftone = {
  id: 'colorHalftone',
  label: 'Color Halftone',
  category: 'pixelate',
  params: [
    P('radius', 'Max. Radius', 2, 64, 4, { unit: 'pt' }),
    P('angle1', 'Cyan Angle', -360, 360, 108, { unit: '°' }),
    P('angle2', 'Magenta Angle', -360, 360, 162, { unit: '°' }),
    P('angle3', 'Yellow Angle', -360, 360, 90, { unit: '°' }),
    P('angle4', 'Black Angle', -360, 360, 45, { unit: '°' }),
  ],
  reach: (p) => p.radius * 1.5,
  run(img, p, ctx) {
    const { w, h } = img;
    const n = w * h;
    // CMYK separation.
    const K = new Float32Array(n);
    const ch = [new Float32Array(n), new Float32Array(n), new Float32Array(n), K];
    for (let i = 0; i < n; i++) {
      const k = 1 - Math.max(img.r[i], img.g[i], img.b[i]);
      K[i] = k;
      const d = 1 - k || 1;
      ch[0][i] = (1 - img.r[i] - k) / d;
      ch[1][i] = (1 - img.g[i] - k) / d;
      ch[2][i] = (1 - img.b[i] - k) / d;
    }
    const cell = Math.max(1, p.radius * 2);
    const ink = ch.map(() => new Float32Array(n));
    const angles = [p.angle1, p.angle2, p.angle3, p.angle4];
    for (let c = 0; c < 4; c++) {
      const a = (angles[c] * Math.PI) / 180;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      let i = 0;
      for (let y = 0; y < h; y++) {
        const Y = docY(ctx, y);
        for (let x = 0; x < w; x++, i++) {
          const X = docX(ctx, x);
          // Into the screen's rotated grid, to the cell center, and back.
          const u = X * ca + Y * sa;
          const v = -X * sa + Y * ca;
          const uc = (Math.floor(u / cell) + 0.5) * cell;
          const vc = (Math.floor(v / cell) + 0.5) * cell;
          const Xc = uc * ca - vc * sa;
          const Yc = uc * sa + vc * ca;
          const val = clamp01(sample(ch[c], w, h, Xc * ctx.k - ctx.ox - 0.5, Yc * ctx.k - ctx.oy - 0.5));
          const r = cell * 0.5 * Math.SQRT2 * Math.sqrt(val);
          const d = Math.hypot(u - uc, v - vc);
          ink[c][i] = clamp01((r - d) * ctx.k + 0.5);
        }
      }
    }
    const out = likeImg(img);
    for (let i = 0; i < n; i++) {
      const k = 1 - ink[3][i];
      out.r[i] = (1 - ink[0][i]) * k;
      out.g[i] = (1 - ink[1][i]) * k;
      out.b[i] = (1 - ink[2][i]) * k;
    }
    return out;
  },
};

const crystallize = {
  id: 'crystallize',
  label: 'Crystallize',
  category: 'pixelate',
  params: [P('size', 'Cell Size', 3, 300, 10, { unit: 'pt' })],
  grow: (p) => p.size,
  reach: (p) => p.size * 1.5,
  run(img, p, ctx) {
    const cl = cells(img, ctx, p.size, ctx.seed);
    const col = siteColors(img, cl);
    const out = createImg(img.w, img.h);
    for (let i = 0; i < cl.site.length; i++) {
      const s = cl.site[i];
      out.r[i] = col.r[s];
      out.g[i] = col.g[s];
      out.b[i] = col.b[s];
      out.a[i] = col.a[s];
    }
    return out;
  },
};

const MEZZO = [
  { value: 'fineDots', label: 'Fine Dots' },
  { value: 'mediumDots', label: 'Medium Dots' },
  { value: 'grainyDots', label: 'Grainy Dots' },
  { value: 'coarseDots', label: 'Coarse Dots' },
  { value: 'shortLines', label: 'Short Lines' },
  { value: 'mediumLines', label: 'Medium Lines' },
  { value: 'longLines', label: 'Long Lines' },
  { value: 'shortStrokes', label: 'Short Strokes' },
  { value: 'mediumStrokes', label: 'Medium Strokes' },
  { value: 'longStrokes', label: 'Long Strokes' },
];

/** Threshold pattern (0..1) of a mezzotint type at a document point. */
function mezzoThreshold(type, X, Y, gx, gy, seed) {
  switch (type) {
    case 'fineDots':
      return hash2(gx, gy, seed);
    case 'mediumDots':
      return hash2(Math.floor(X / 1.2), Math.floor(Y / 1.2), seed);
    case 'grainyDots':
      return lerp(hash2(gx, gy, seed), noise2(X / 1.5, Y / 1.5, seed), 0.6);
    case 'coarseDots':
      return hash2(Math.floor(X / 2.6), Math.floor(Y / 2.6), seed);
    case 'shortLines':
    case 'mediumLines':
    case 'longLines': {
      const len = { shortLines: 4, mediumLines: 10, longLines: 24 }[type];
      const row = Math.floor(Y / 0.9);
      return noise2(X / len + hash2(row, 0, seed) * 50, row * 3.7, seed);
    }
    default: {
      const len = { shortStrokes: 3, mediumStrokes: 7, longStrokes: 14 }[type] || 7;
      const a = (X + Y) * Math.SQRT1_2;
      const b = (X - Y) * Math.SQRT1_2;
      const row = Math.floor(b / 0.9);
      return noise2(a / len + hash2(row, 1, seed) * 50, row * 3.7, seed);
    }
  }
}

const mezzotint = {
  id: 'mezzotint',
  label: 'Mezzotint',
  category: 'pixelate',
  params: [S('type', 'Type', MEZZO, 'mediumDots')],
  run(img, p, ctx) {
    const out = likeImg(img);
    const chans = ['r', 'g', 'b'];
    let i = 0;
    for (let y = 0; y < img.h; y++) {
      const Y = docY(ctx, y);
      for (let x = 0; x < img.w; x++, i++) {
        const X = docX(ctx, x);
        for (let c = 0; c < 3; c++) {
          const t = mezzoThreshold(p.type, X, Y, x + ctx.ox, y + ctx.oy, ctx.seed + c * 31);
          out[chans[c]][i] = img[chans[c]][i] > t ? 1 : 0;
        }
      }
    }
    return out;
  },
};

const pointillize = {
  id: 'pointillize',
  label: 'Pointillize',
  category: 'pixelate',
  params: [P('size', 'Cell Size', 3, 300, 6, { unit: 'pt' }), C('background', 'Background', '#ffffff')],
  reach: (p) => p.size * 1.5,
  run(img, p, ctx) {
    const cl = cells(img, ctx, p.size, ctx.seed, 1);
    const col = siteColors(img, cl);
    const bg = hexRgb(p.background);
    const out = likeImg(img);
    const c = cl.size;
    const { w, h } = img;
    for (let y = 0; y < h; y++) {
      const cj = Math.floor((y + ctx.oy) / c) - cl.j0;
      for (let x = 0; x < w; x++) {
        const ci = Math.floor((x + ctx.ox) / c) - cl.i0;
        let best = Infinity;
        let bs = -1;
        let cover = 0;
        for (let dj = -1; dj <= 1; dj++) {
          for (let di = -1; di <= 1; di++) {
            const ii = ci + di;
            const jj = cj + dj;
            if (ii < 0 || jj < 0 || ii >= cl.cols || jj >= cl.rows) continue;
            const k = jj * cl.cols + ii;
            const rad = c * (0.5 + 0.25 * hash2(ii + cl.i0, jj + cl.j0, ctx.seed + 11));
            const d = Math.hypot(cl.sx[k] - x, cl.sy[k] - y) / rad;
            if (d < best) {
              best = d;
              bs = k;
              cover = clamp01((1 - d) * rad + 0.5);
            }
          }
        }
        const i = y * w + x;
        const j = bs >= 0 ? (hash2((bs % cl.cols) + cl.i0, Math.floor(bs / cl.cols) + cl.j0, ctx.seed + 5) - 0.5) * 0.12 : 0;
        const t = bs >= 0 ? cover : 0;
        out.r[i] = clamp01(lerp(bg[0], col.r[bs] + j, t));
        out.g[i] = clamp01(lerp(bg[1], col.g[bs] + j, t));
        out.b[i] = clamp01(lerp(bg[2], col.b[bs] + j, t));
      }
    }
    return out;
  },
};

// ---- Sketch ----

const basRelief = {
  id: 'basRelief',
  label: 'Bas Relief',
  category: 'sketch',
  params: [P('detail', 'Detail', 1, 15, 13), P('smoothness', 'Smoothness', 1, 15, 3), S('light', 'Light', LIGHTS, 'bottom'), ...INK()],
  reach: (p) => p.smoothness * 0.3 + 3,
  run(img, p, ctx) {
    const H = gauss(lum(img), img.w, img.h, px(ctx, p.smoothness * 0.2 + (15 - p.detail) * 0.08));
    const t = shade(H, img.w, img.h, ctx.k, lightVec(p.light), 0.4 + p.detail * 0.12);
    return inkPaper(img, t.map((v) => clamp01((v - 0.5) * 1.6 + 0.5)), p.ink, p.paper);
  },
};

const charcoal = {
  id: 'charcoal',
  label: 'Charcoal',
  category: 'sketch',
  params: [P('thickness', 'Charcoal Thickness', 1, 7, 1), P('detail', 'Detail', 0, 5, 5), P('balance', 'Light/Dark Balance', 0, 100, 50), ...INK()],
  reach: () => 3,
  run(img, p, ctx) {
    const L = gauss(lum(img), img.w, img.h, px(ctx, (5 - p.detail) * 0.3));
    const E = sobel(L, img.w, img.h).mag;
    const wd = 0.5 + p.thickness * 0.35;
    const st = field(img, ctx, (X, Y) => noise2((X - Y) / wd, (X + Y) / (wd * 8), ctx.seed));
    const bal = (p.balance - 50) / 100;
    const t = L.map((l, i) => {
      const v = l + bal - E[i] * (2 + p.detail) + (st[i] - 0.5) * 0.55;
      return smoothstep(0.38, 0.62, v);
    });
    return inkPaper(img, t, p.ink, p.paper);
  },
};

const chrome = {
  id: 'chrome',
  label: 'Chrome',
  category: 'sketch',
  params: [P('detail', 'Detail', 0, 10, 4), P('smoothness', 'Smoothness', 0, 10, 7)],
  reach: (p) => p.smoothness * 0.4 + 2,
  run(img, p, ctx) {
    const H = gauss(lum(img), img.w, img.h, px(ctx, p.smoothness * 0.35 + 0.5));
    const sh = shade(H, img.w, img.h, ctx.k, lightVec('topLeft'), 1.5);
    const f = 1.5 + p.detail * 0.5;
    return mapColor(img, (r, g, b, i) => {
      const v = 0.5 + 0.5 * Math.cos(H[i] * Math.PI * f + (sh[i] - 0.5) * 4);
      const c = clamp01(v * v * (3 - 2 * v) * 0.85 + sh[i] * 0.15);
      return [c, c, c];
    });
  },
};

const PEN_DIRS = [
  { value: 'rightDiagonal', label: 'Right Diagonal', v: [1, -1] },
  { value: 'horizontal', label: 'Horizontal', v: [1, 0] },
  { value: 'leftDiagonal', label: 'Left Diagonal', v: [1, 1] },
  { value: 'vertical', label: 'Vertical', v: [0, 1] },
];

const graphicPen = {
  id: 'graphicPen',
  label: 'Graphic Pen',
  category: 'sketch',
  params: [P('length', 'Stroke Length', 1, 15, 15, { unit: 'pt' }), P('balance', 'Light/Dark Balance', 0, 100, 50), S('direction', 'Stroke Direction', PEN_DIRS.map(({ value, label }) => ({ value, label })), 'rightDiagonal'), ...INK()],
  reach: () => 1,
  run(img, p, ctx) {
    const L = gauss(lum(img), img.w, img.h, px(ctx, 0.3));
    const v = (PEN_DIRS.find((d) => d.value === p.direction) || PEN_DIRS[0]).v;
    const n = Math.hypot(v[0], v[1]);
    const ux = v[0] / n;
    const uy = v[1] / n;
    const st = field(img, ctx, (X, Y) => {
      const along = X * ux + Y * uy;
      const across = -X * uy + Y * ux;
      return noise2(across / 0.55, along / (p.length * 0.6 + 0.5), ctx.seed);
    });
    const bal = (p.balance - 50) / 100;
    const t = L.map((l, i) => (l + bal > st[i] ? 1 : 0));
    return inkPaper(img, t, p.ink, p.paper);
  },
};

const HALFTONE = [
  { value: 'dot', label: 'Dot' },
  { value: 'circle', label: 'Circle' },
  { value: 'line', label: 'Line' },
];

const halftonePattern = {
  id: 'halftonePattern',
  label: 'Halftone Pattern',
  category: 'sketch',
  params: [P('size', 'Size', 1, 12, 1, { unit: 'pt' }), P('contrast', 'Contrast', 0, 50, 5), S('pattern', 'Pattern Type', HALFTONE, 'dot'), ...INK()],
  reach: (p) => p.size * 2 + 2,
  run(img, p, ctx) {
    const { w, h } = img;
    const L = lum(img);
    const cst = 1 + p.contrast / 10;
    const Lc = L.map((v) => clamp01((v - 0.5) * cst + 0.5));
    const cell = (p.size + 1) * 1.5;
    const bd = ctx.bounds || { x: 0, y: 0, w, h };
    const cx = docX(ctx, bd.x + bd.w / 2);
    const cy = docY(ctx, bd.y + bd.h / 2);
    const t = new Float32Array(w * h);
    let i = 0;
    for (let y = 0; y < h; y++) {
      const Y = docY(ctx, y);
      for (let x = 0; x < w; x++, i++) {
        const X = docX(ctx, x);
        const dark = 1 - Lc[i];
        let d;
        if (p.pattern === 'dot') {
          const xc = (Math.floor(X / cell) + 0.5) * cell;
          const yc = (Math.floor(Y / cell) + 0.5) * cell;
          const dk = 1 - clamp01(sample(Lc, w, h, xc * ctx.k - ctx.ox - 0.5, yc * ctx.k - ctx.oy - 0.5));
          d = cell * 0.5 * Math.SQRT2 * Math.sqrt(dk) - Math.hypot(X - xc, Y - yc);
        } else {
          const ph = p.pattern === 'circle' ? Math.hypot(X - cx, Y - cy) / cell : Y / cell;
          const f = ph - Math.floor(ph);
          d = (dark * 0.5 - Math.abs(f - 0.5)) * cell;
        }
        t[i] = 1 - clamp01(d * ctx.k + 0.5);
      }
    }
    return inkPaper(img, t, p.ink, p.paper);
  },
};

const photocopy = {
  id: 'photocopy',
  label: 'Photocopy',
  category: 'sketch',
  params: [P('detail', 'Detail', 1, 24, 7), P('darkness', 'Darkness', 1, 50, 8), ...INK()],
  reach: (p) => p.detail * 0.75 + 2,
  run(img, p, ctx) {
    const L = lum(img);
    const Bl = gauss(L, img.w, img.h, px(ctx, p.detail * 0.25 + 0.5));
    const t = L.map((l, i) => 1 - clamp01((Bl[i] - l) * p.darkness * 0.9 - 0.02));
    return inkPaper(img, t, p.ink, p.paper);
  },
};

const stamp = {
  id: 'stamp',
  label: 'Stamp',
  category: 'sketch',
  params: [P('balance', 'Light/Dark Balance', 0, 50, 25), P('smoothness', 'Smoothness', 1, 50, 5), ...INK()],
  reach: (p) => p.smoothness * 0.36 + 1,
  run(img, p, ctx) {
    const S0 = gauss(lum(img), img.w, img.h, px(ctx, p.smoothness * 0.12));
    const thr = p.balance / 50;
    return inkPaper(img, S0.map((v) => smoothstep(thr - 0.015, thr + 0.015, v)), p.ink, p.paper);
  },
};

const tornEdges = {
  id: 'tornEdges',
  label: 'Torn Edges',
  category: 'sketch',
  params: [P('balance', 'Image Balance', 0, 50, 25), P('smoothness', 'Smoothness', 1, 15, 11), P('contrast', 'Contrast', 1, 25, 17), ...INK()],
  reach: (p) => p.smoothness * 0.3 + 2,
  run(img, p, ctx) {
    const S0 = gauss(lum(img), img.w, img.h, px(ctx, p.smoothness * 0.1));
    const rough = ((16 - p.smoothness) / 15) * 0.35;
    const nz = field(img, ctx, (X, Y) => fbm(X / 1.8, Y / 1.8, ctx.seed, 4) - 0.5);
    const thr = p.balance / 50;
    return inkPaper(img, S0.map((v, i) => clamp01((v + nz[i] * rough - thr) * p.contrast * 0.9 + 0.5)), p.ink, p.paper);
  },
};

// ---- Stylize ----

const glowingEdges = {
  id: 'glowingEdges',
  label: 'Glowing Edges',
  category: 'stylize',
  params: [P('width', 'Edge Width', 1, 14, 2), P('brightness', 'Edge Brightness', 0, 20, 6), P('smoothness', 'Smoothness', 1, 15, 5)],
  grow: (p) => p.width * 0.3,
  reach: (p) => p.smoothness * 0.3 + p.width * 0.5 + 2,
  run(img, p, ctx) {
    const { w, h } = img;
    const Sm = blurColor(img, px(ctx, p.smoothness * 0.1));
    const out = createImg(w, h);
    const sig = px(ctx, p.width * 0.18);
    const gain = (p.brightness + 1) * 0.35;
    for (const c of ['r', 'g', 'b']) {
      // Premultiplied, so the outline of the object glows too.
      const pm = Sm[c].map((v, i) => v * img.a[i]);
      const E = gauss(sobel(pm, w, h).mag, w, h, sig);
      for (let i = 0; i < E.length; i++) out[c][i] = clamp01(E[i] * gain);
    }
    const Ea = gauss(sobel(img.a, w, h).mag, w, h, sig);
    for (let i = 0; i < w * h; i++) out.a[i] = Math.max(img.a[i], clamp01(Ea[i] * 6));
    return out;
  },
};

// ---- Texture ----

const craquelure = {
  id: 'craquelure',
  label: 'Craquelure',
  category: 'texture',
  params: [P('spacing', 'Crack Spacing', 2, 100, 15, { unit: 'pt' }), P('depth', 'Crack Depth', 0, 10, 6), P('brightness', 'Crack Brightness', 0, 10, 9)],
  reach: (p) => p.spacing,
  run(img, p, ctx) {
    const cl = cells(img, ctx, p.spacing, ctx.seed, 1);
    const crackW = Math.max(0.6, ctx.k * 0.5);
    const bevel = Math.max(1, cl.size * 0.3);
    const fine = field(img, ctx, (X, Y) => fbm(X / 1.5, Y / 1.5, ctx.seed + 3, 2));
    const dep = p.depth / 10;
    const br = 0.55 + (p.brightness / 10) * 0.45;
    return mapColor(img, (r, g, b, i) => {
      const gap = (cl.d2[i] - cl.d1[i]) * 0.5 + (fine[i] - 0.5) * crackW;
      const crack = 1 - smoothstep(0, crackW, gap);
      const relief = smoothstep(0, bevel, gap) - 0.5;
      const m = br * (1 - crack * dep * 0.85) + relief * dep * 0.25 + (1 - br) * 0.3;
      return [r * m, g * m, b * m];
    });
  },
};

const GRAIN_TYPES = [
  { value: 'regular', label: 'Regular' },
  { value: 'soft', label: 'Soft' },
  { value: 'sprinkles', label: 'Sprinkles' },
  { value: 'clumped', label: 'Clumped' },
  { value: 'contrasty', label: 'Contrasty' },
  { value: 'enlarged', label: 'Enlarged' },
  { value: 'stippled', label: 'Stippled' },
  { value: 'horizontal', label: 'Horizontal' },
  { value: 'vertical', label: 'Vertical' },
  { value: 'speckle', label: 'Speckle' },
];

const grain = {
  id: 'grain',
  label: 'Grain',
  category: 'texture',
  params: [P('intensity', 'Intensity', 0, 100, 40), P('contrast', 'Contrast', 0, 100, 50), S('type', 'Grain Type', GRAIN_TYPES, 'regular')],
  run(img, p, ctx) {
    const amt = p.intensity / 100;
    const cst = 0.5 + p.contrast / 100;
    const out = likeImg(img);
    let i = 0;
    for (let y = 0; y < img.h; y++) {
      const Y = docY(ctx, y);
      for (let x = 0; x < img.w; x++, i++) {
        const X = docX(ctx, x);
        const gx = x + ctx.ox;
        const gy = y + ctx.oy;
        const hsh = hash2(gx, gy, ctx.seed);
        let n = 0;
        let rgb = null;
        switch (p.type) {
          case 'soft':
            n = (noise2(X / 0.8, Y / 0.8, ctx.seed) - 0.5) * 1.4;
            break;
          case 'sprinkles':
            n = hsh > 1 - amt * 0.25 ? -0.8 : hsh < amt * 0.08 ? 0.8 : 0;
            break;
          case 'clumped':
            n = (fbm(X / 1.6, Y / 1.6, ctx.seed, 3) - 0.5) * 2;
            break;
          case 'contrasty':
            n = hsh > 0.5 ? 0.9 : -0.9;
            break;
          case 'enlarged':
            n = (noise2(X / 2.4, Y / 2.4, ctx.seed) - 0.5) * 2;
            break;
          case 'stippled':
            n = hsh < amt * 0.5 ? -0.9 : 0.15;
            break;
          case 'horizontal':
            n = (hash2(Math.floor(X / 5), gy, ctx.seed) - 0.5) * 1.6;
            break;
          case 'vertical':
            n = (hash2(gx, Math.floor(Y / 5), ctx.seed) - 0.5) * 1.6;
            break;
          case 'speckle':
            if (hsh < amt * 0.12) rgb = [hash2(gx, gy, ctx.seed + 1), hash2(gx, gy, ctx.seed + 2), hash2(gx, gy, ctx.seed + 3)];
            break;
          default:
            n = (hsh + hash2(gx, gy, ctx.seed + 1) - 1) * 1.4;
        }
        const f = (v) => clamp01((v + n * amt * 0.6 - 0.5) * cst + 0.5);
        out.r[i] = rgb ? rgb[0] : f(img.r[i]);
        out.g[i] = rgb ? rgb[1] : f(img.g[i]);
        out.b[i] = rgb ? rgb[2] : f(img.b[i]);
      }
    }
    return out;
  },
};

const mosaicTiles = {
  id: 'mosaicTiles',
  label: 'Mosaic Tiles',
  category: 'texture',
  params: [P('size', 'Tile Size', 2, 100, 12, { unit: 'pt' }), P('grout', 'Grout Width', 1, 15, 3), P('lighten', 'Lighten Grout', 0, 10, 9)],
  run(img, p, ctx) {
    const s = p.size;
    const gw = p.grout * 0.18;
    const bev = Math.min(s * 0.25, 1.5);
    const gl = p.lighten / 10;
    return mapColor(
      img,
      (() => {
        const cache = field(img, ctx, (X, Y) => {
          const row = Math.floor(Y / s);
          const off = (hash2(row, 0, ctx.seed) - 0.5) * s * 0.6;
          const xx = X + off;
          const col = Math.floor(xx / s);
          // Tile edges wander a little, so the grid reads as hand-laid.
          const jx = (hash2(col, row, ctx.seed + 1) - 0.5) * s * 0.12;
          const fx = xx - col * s + jx;
          const fy = Y - row * s + (hash2(col, row, ctx.seed + 2) - 0.5) * s * 0.12;
          const dEdge = Math.min(fx, s - fx, fy, s - fy);
          // Encode distance to the grout and the light side in one number.
          const lit = fx < bev || fy < bev ? 1 : s - fx < bev || s - fy < bev ? -1 : 0;
          return dEdge + lit * 1e4;
        });
        return (r, g, b, i) => {
          const v = cache[i];
          const lit = v > 5e3 ? 1 : v < -5e3 ? -1 : 0;
          const d = v - lit * 1e4;
          if (d < gw / 2) {
            const m = lerp(0.25, 1, gl);
            return [lerp(r * 0.4, m, gl), lerp(g * 0.4, m, gl), lerp(b * 0.4, m, gl)];
          }
          const sh = 1 + lit * 0.12;
          return [r * sh, g * sh, b * sh];
        };
      })(),
    );
  },
};

const patchwork = {
  id: 'patchwork',
  label: 'Patchwork',
  category: 'texture',
  params: [P('size', 'Square Size', 0, 10, 4), P('relief', 'Relief', 0, 25, 8)],
  reach: (p) => (p.size + 1) * 2,
  run(img, p, ctx) {
    const { w, h } = img;
    const s = (p.size + 1) * 1.6;
    const rel = p.relief / 25;
    const out = likeImg(img);
    let i = 0;
    for (let y = 0; y < h; y++) {
      const Y = docY(ctx, y);
      for (let x = 0; x < w; x++, i++) {
        const X = docX(ctx, x);
        const ci = Math.floor(X / s);
        const cj = Math.floor(Y / s);
        const xc = (ci + 0.5) * s;
        const yc = (cj + 0.5) * s;
        const sx = xc * ctx.k - ctx.ox - 0.5;
        const sy = yc * ctx.k - ctx.oy - 0.5;
        const fx = (X - ci * s) / s;
        const fy = (Y - cj * s) / s;
        const edge = Math.min(fx, fy, 1 - fx, 1 - fy);
        const lit = edge < 0.15 ? (fx < 0.15 || fy < 0.15 ? 1 : -1) : 0;
        const depth = (hash2(ci, cj, ctx.seed) - 0.5) * 0.25;
        const m = 1 + (lit * 0.3 + depth) * rel;
        out.r[i] = clamp01(sample(img.r, w, h, sx, sy) * m);
        out.g[i] = clamp01(sample(img.g, w, h, sx, sy) * m);
        out.b[i] = clamp01(sample(img.b, w, h, sx, sy) * m);
      }
    }
    return out;
  },
};

const stainedGlass = {
  id: 'stainedGlass',
  label: 'Stained Glass',
  category: 'texture',
  params: [P('size', 'Cell Size', 2, 50, 10, { unit: 'pt' }), P('border', 'Border Thickness', 1, 20, 4), P('light', 'Light Intensity', 0, 10, 3), C('lead', 'Border Color', '#1c1c1c')],
  reach: (p) => p.size * 1.5,
  run(img, p, ctx) {
    const cl = cells(img, ctx, p.size, ctx.seed, 1);
    const col = siteColors(img, cl);
    const lead = hexRgb(p.lead);
    const bw = Math.max(0.5, p.border * 0.12 * ctx.k);
    const bd = ctx.bounds || { x: 0, y: 0, w: img.w, h: img.h };
    const cx = bd.x + bd.w / 2;
    const cy = bd.y + bd.h / 2;
    const maxD = Math.hypot(bd.w, bd.h) / 2 || 1;
    const li = p.light / 10;
    return mapColor(img, (r, g, b, i) => {
      const s = cl.site[i];
      const gap = (cl.d2[i] - cl.d1[i]) * 0.5;
      const t = smoothstep(bw - 0.6, bw + 0.6, gap);
      const x = i % img.w;
      const y = (i / img.w) | 0;
      const glow = li * 0.45 * (1 - Math.min(1, Math.hypot(x - cx, y - cy) / maxD));
      const m = (col.r[s] + col.g[s] + col.b[s]) / 3;
      const sat = (v) => clamp01(m + (v - m) * 1.35 + glow);
      return [lerp(lead[0], sat(col.r[s]), t), lerp(lead[1], sat(col.g[s]), t), lerp(lead[2], sat(col.b[s]), t)];
    });
  },
};

const TEXTURES = [
  { value: 'brick', label: 'Brick' },
  { value: 'burlap', label: 'Burlap' },
  { value: 'canvas', label: 'Canvas' },
  { value: 'sandstone', label: 'Sandstone' },
];

/** Procedural height (0..1) of a texturizer surface at a document point. */
export function textureHeight(type, X, Y, s, seed) {
  if (type === 'brick') {
    const bh = 6 * s;
    const bw = 14 * s;
    const row = Math.floor(Y / bh);
    const xx = X + (row % 2 ? bw / 2 : 0);
    const fx = xx / bw - Math.floor(xx / bw);
    const fy = Y / bh - row;
    const d = Math.min(fx * bw, (1 - fx) * bw, fy * bh, (1 - fy) * bh);
    const groove = 0.8 * s;
    return smoothstep(0, groove, d) * (0.85 + 0.15 * fbm(X / (2 * s), Y / (2 * s), seed, 2));
  }
  if (type === 'burlap') {
    const c = 2.2 * s;
    const u = Math.sin((X / c) * Math.PI);
    const v = Math.sin((Y / c) * Math.PI);
    const over = Math.sign(Math.sin((X / c) * Math.PI * 0.5 + 0.5) * Math.sin((Y / c) * Math.PI * 0.5 + 0.5));
    return clamp01(0.5 + 0.35 * (over > 0 ? Math.abs(v) : Math.abs(u)) + 0.25 * (noise2(X / s, Y / (4 * s), seed) - 0.5));
  }
  if (type === 'canvas') {
    const c = 1.1 * s;
    const u = Math.sin((X / c) * Math.PI);
    const v = Math.sin((Y / c) * Math.PI);
    return 0.5 + 0.25 * (Math.abs(u) * Math.sign(v) + Math.abs(v) * Math.sign(u)) * 0.8 + 0.1 * (hash2(Math.floor(X / c), Math.floor(Y / c), seed) - 0.5);
  }
  return fbm(X / (1.2 * s), Y / (1.2 * s), seed, 4);
}

const texturizer = {
  id: 'texturizer',
  label: 'Texturizer',
  category: 'texture',
  params: [S('texture', 'Texture', TEXTURES, 'canvas'), P('scaling', 'Scaling', 50, 200, 100, { unit: '%' }), P('relief', 'Relief', 0, 50, 4), S('light', 'Light', LIGHTS, 'top'), B('invert', 'Invert', false)],
  run(img, p, ctx) {
    const s = p.scaling / 100;
    let H = field(img, ctx, (X, Y) => textureHeight(p.texture, X, Y, s, ctx.seed));
    if (p.invert) H = H.map((v) => 1 - v);
    H = gauss(H, img.w, img.h, Math.max(0.4, ctx.k * 0.2));
    const sh = shade(H, img.w, img.h, ctx.k, lightVec(p.light), 0.6);
    const rel = (p.relief / 50) * 1.4;
    return mapColor(img, (r, g, b, i) => {
      const m = 1 + (sh[i] - 0.5) * rel * 2;
      return [r * m, g * m, b * m];
    });
  },
};

export const FILTERS_B = [
  colorHalftone,
  crystallize,
  mezzotint,
  pointillize,
  basRelief,
  charcoal,
  chrome,
  graphicPen,
  halftonePattern,
  photocopy,
  stamp,
  tornEdges,
  glowingEdges,
  craquelure,
  grain,
  mosaicTiles,
  patchwork,
  stainedGlass,
  texturizer,
];
