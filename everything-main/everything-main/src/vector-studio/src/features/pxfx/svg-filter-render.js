/**
 * SVG filters: parsing <filter> markup and rendering it on float images,
 * so filters draw the same in every browser (canvas url() filters are not
 * available everywhere) and match what an SVG viewer shows for the
 * exported <filter>.
 *
 * Supported primitives: feBlend, feColorMatrix, feComponentTransfer,
 * feComposite, feConvolveMatrix, feDiffuseLighting, feDisplacementMap,
 * feDropShadow, feFlood, feGaussianBlur, feMerge, feMorphology, feOffset,
 * feSpecularLighting, feTile and feTurbulence (feImage draws nothing).
 * Inputs: SourceGraphic, SourceAlpha and named results (background and
 * paint inputs are transparent). color-interpolation-filters is honored.
 */
import { clamp01, gauss, createImg, sample, sampleZero, docX, docY } from './img.js';

// ---- parsing ----

const PRIMS = new Set([
  'feBlend',
  'feColorMatrix',
  'feComponentTransfer',
  'feComposite',
  'feConvolveMatrix',
  'feDiffuseLighting',
  'feDisplacementMap',
  'feDropShadow',
  'feFlood',
  'feGaussianBlur',
  'feImage',
  'feMerge',
  'feMorphology',
  'feOffset',
  'feSpecularLighting',
  'feTile',
  'feTurbulence',
]);

function attrsOf(el) {
  const out = {};
  for (const a of el.attributes) out[a.localName] = a.value;
  // Presentation properties may also come as style declarations.
  const style = el.getAttribute('style');
  if (style) {
    for (const decl of style.split(';')) {
      const i = decl.indexOf(':');
      if (i > 0) out[decl.slice(0, i).trim()] = decl.slice(i + 1).trim();
    }
  }
  return out;
}

function parseXml(text) {
  if (typeof DOMParser === 'undefined') return null;
  const xml = new DOMParser().parseFromString(text, 'image/svg+xml');
  if (xml.getElementsByTagName('parsererror').length) return null;
  return xml;
}

/** Compile one <filter> element to { attrs, prims: [{ type, attrs, children }] }. */
function compileElement(el) {
  const prims = [];
  for (const c of el.children) {
    if (!PRIMS.has(c.localName)) continue;
    prims.push({ type: c.localName, attrs: attrsOf(c), children: [...c.children].map((k) => ({ type: k.localName, attrs: attrsOf(k) })) });
  }
  return { attrs: attrsOf(el), prims };
}

const compiled = new Map();

/** Compiled filter for markup holding one <filter> (cached), or null. */
export function compileFilter(markup) {
  if (compiled.has(markup)) return compiled.get(markup);
  let out = null;
  const xml = parseXml(/<svg[\s>]/.test(markup) ? markup : `<svg xmlns="http://www.w3.org/2000/svg">${markup}</svg>`);
  const el = xml && xml.getElementsByTagNameNS('*', 'filter')[0];
  if (el) out = compileElement(el);
  if (compiled.size > 200) compiled.clear();
  compiled.set(markup, out);
  return out;
}

/**
 * The <filter> elements of an SVG file: [{ id, name, markup }] where
 * markup is the filter serialized on its own (with the SVG namespace).
 */
export function filtersFromSvg(text) {
  const xml = parseXml(String(text || ''));
  if (!xml) return [];
  const out = [];
  const ser = typeof XMLSerializer !== 'undefined' ? new XMLSerializer() : null;
  for (const el of xml.getElementsByTagNameNS('*', 'filter')) {
    const c = compileElement(el);
    if (!c.prims.length) continue;
    const id = el.getAttribute('id') || `filter${out.length + 1}`;
    const name = el.getAttribute('inkscape:label') || el.querySelector('title')?.textContent?.trim() || id;
    let markup = ser ? ser.serializeToString(el) : el.outerHTML;
    if (!/xmlns=/.test(markup)) markup = markup.replace(/^<filter/, '<filter xmlns="http://www.w3.org/2000/svg"');
    out.push({ id, name, markup });
  }
  return out;
}

// ---- lengths and regions ----

const num = (v, d = 0) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : d;
};
const nums = (v) => String(v || '').trim().split(/[\s,]+/).filter(Boolean).map(Number).filter(Number.isFinite);
/** A filter-region value in bbox units: '10%' or 0.1 -> 0.1. */
const frac = (v, d) => {
  if (v == null || v === '') return d;
  const s = String(v).trim();
  return s.endsWith('%') ? num(s) / 100 : num(s, d);
};

/** The filter region in document units for object bounds b. */
export function filterRegion(f, b) {
  const a = f.attrs;
  if (a.filterUnits === 'userSpaceOnUse') {
    const def = (v, d) => (v == null ? d : String(v).endsWith('%') ? null : num(v));
    const x = def(a.x, null);
    const y = def(a.y, null);
    const w = def(a.width, null);
    const h = def(a.height, null);
    if (x != null && y != null && w != null && h != null) return { x, y, w, h };
  }
  const fx = frac(a.x, -0.1);
  const fy = frac(a.y, -0.1);
  const fw = frac(a.width, 1.2);
  const fh = frac(a.height, 1.2);
  return { x: b.x + fx * b.w, y: b.y + fy * b.h, w: fw * b.w, h: fh * b.h };
}

/** How far (document units) a filter can reach past bounds b. */
export function filterOutset(f, b) {
  if (!f || !b) return 0;
  const r = filterRegion(f, b);
  return Math.max(0, b.x - r.x, b.y - r.y, r.x + r.w - (b.x + b.w), r.y + r.h - (b.y + b.h));
}

// ---- color ----

const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const srgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

const NAMED = { black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff', yellow: '#ffff00', gray: '#808080', grey: '#808080', orange: '#ffa500', purple: '#800080', transparent: '#000000' };

/** CSS color -> [r, g, b, a] (sRGB, 0..1). */
export function parseColor(v, d = [0, 0, 0, 1]) {
  if (!v) return d;
  let s = String(v).trim().toLowerCase();
  if (NAMED[s]) {
    const c = parseColor(NAMED[s]);
    return s === 'transparent' ? [0, 0, 0, 0] : c;
  }
  if (/^#[0-9a-f]{3}$/.test(s)) s = `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  if (/^#[0-9a-f]{6}$/.test(s)) {
    const n = parseInt(s.slice(1), 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1];
  }
  const m = s.match(/^rgba?\(([^)]*)\)$/);
  if (m) {
    const p = m[1].split(/[\s,/]+/).filter(Boolean);
    const ch = (x) => (x.endsWith('%') ? num(x) / 100 : num(x) / 255);
    return [ch(p[0]), ch(p[1]), ch(p[2]), p[3] != null ? (p[3].endsWith('%') ? num(p[3]) / 100 : num(p[3], 1)) : 1];
  }
  return d;
}

// Images inside the renderer: premultiplied planes { w, h, r, g, b, a, lin, sub }.

function blank(w, h, isLin) {
  return { ...createImg(w, h), lin: isLin, sub: null };
}

function convert(im, toLinear) {
  if (im.lin === toLinear) return im;
  const out = blank(im.w, im.h, toLinear);
  out.a.set(im.a);
  out.sub = im.sub;
  const f = toLinear ? lin : srgb;
  for (const c of ['r', 'g', 'b']) {
    const s = im[c];
    const o = out[c];
    for (let i = 0; i < s.length; i++) {
      const a = im.a[i];
      o[i] = a > 0 ? f(clamp01(s[i] / a)) * a : 0;
    }
  }
  return out;
}

// ---- turbulence (the published SVG reference algorithm) ----

const BSize = 0x100;
const BM = 0xff;
const PerlinN = 0x1000;

function turbulenceTables(seedIn) {
  let seed = Math.round(seedIn);
  if (seed <= 0) seed = -(seed % (2147483647 - 1)) + 1;
  if (seed > 2147483647 - 1) seed = 2147483647 - 1;
  const random = () => {
    seed = 16807 * (seed % 127773) - 2836 * Math.floor(seed / 127773);
    if (seed <= 0) seed += 2147483647;
    return seed;
  };
  const lattice = new Int32Array(BSize + BSize + 2);
  const grad = [0, 1, 2, 3].map(() => new Float64Array((BSize + BSize + 2) * 2));
  for (let k = 0; k < 4; k++) {
    for (let i = 0; i < BSize; i++) {
      lattice[i] = i;
      const g0 = ((random() % (BSize + BSize)) - BSize) / BSize;
      const g1 = ((random() % (BSize + BSize)) - BSize) / BSize;
      const s = Math.sqrt(g0 * g0 + g1 * g1) || 1;
      grad[k][i * 2] = g0 / s;
      grad[k][i * 2 + 1] = g1 / s;
    }
  }
  for (let i = BSize - 1; i > 0; i--) {
    const k = lattice[i];
    const j = random() % BSize;
    lattice[i] = lattice[j];
    lattice[j] = k;
  }
  for (let i = 0; i < BSize + 2; i++) {
    lattice[BSize + i] = lattice[i];
    for (let k = 0; k < 4; k++) {
      grad[k][(BSize + i) * 2] = grad[k][i * 2];
      grad[k][(BSize + i) * 2 + 1] = grad[k][i * 2 + 1];
    }
  }
  return { lattice, grad };
}

function noise2(T, ch, vx, vy, st) {
  const sc = (t) => t * t * (3 - 2 * t);
  let t = vx + PerlinN;
  let bx0 = Math.trunc(t);
  let bx1 = bx0 + 1;
  const rx0 = t - Math.trunc(t);
  const rx1 = rx0 - 1;
  t = vy + PerlinN;
  let by0 = Math.trunc(t);
  let by1 = by0 + 1;
  const ry0 = t - Math.trunc(t);
  const ry1 = ry0 - 1;
  if (st) {
    if (bx0 >= st.wrapX) bx0 -= st.width;
    if (bx1 >= st.wrapX) bx1 -= st.width;
    if (by0 >= st.wrapY) by0 -= st.height;
    if (by1 >= st.wrapY) by1 -= st.height;
  }
  bx0 &= BM;
  bx1 &= BM;
  by0 &= BM;
  by1 &= BM;
  const L = T.lattice;
  const G = T.grad[ch];
  const i = L[bx0];
  const j = L[bx1];
  const b00 = L[i + by0];
  const b10 = L[j + by0];
  const b01 = L[i + by1];
  const b11 = L[j + by1];
  const sx = sc(rx0);
  const sy = sc(ry0);
  let u = rx0 * G[b00 * 2] + ry0 * G[b00 * 2 + 1];
  let v = rx1 * G[b10 * 2] + ry0 * G[b10 * 2 + 1];
  const a = u + sx * (v - u);
  u = rx0 * G[b01 * 2] + ry1 * G[b01 * 2 + 1];
  v = rx1 * G[b11 * 2] + ry1 * G[b11 * 2 + 1];
  const b = u + sx * (v - u);
  return a + sy * (b - a);
}

function turbulence(T, ch, x, y, fx, fy, octaves, fractal, tile) {
  let st = null;
  if (tile) {
    if (fx !== 0) {
      const lo = Math.floor(tile.w * fx) / tile.w;
      const hi = Math.ceil(tile.w * fx) / tile.w;
      fx = lo && fx / lo < hi / fx ? lo : hi;
    }
    if (fy !== 0) {
      const lo = Math.floor(tile.h * fy) / tile.h;
      const hi = Math.ceil(tile.h * fy) / tile.h;
      fy = lo && fy / lo < hi / fy ? lo : hi;
    }
    const width = Math.trunc(tile.w * fx + 0.5);
    const height = Math.trunc(tile.h * fy + 0.5);
    st = { width, height, wrapX: Math.trunc(tile.x * fx + PerlinN + width), wrapY: Math.trunc(tile.y * fy + PerlinN + height) };
  }
  let sum = 0;
  let vx = x * fx;
  let vy = y * fy;
  let ratio = 1;
  for (let o = 0; o < octaves; o++) {
    const n = noise2(T, ch, vx, vy, st);
    sum += (fractal ? n : Math.abs(n)) / ratio;
    vx *= 2;
    vy *= 2;
    ratio *= 2;
    if (st) {
      st.width *= 2;
      st.wrapX = 2 * st.wrapX - PerlinN;
      st.height *= 2;
      st.wrapY = 2 * st.wrapY - PerlinN;
    }
  }
  return sum;
}

// ---- primitives ----

const CH = ['r', 'g', 'b', 'a'];

function each(w, h, fn) {
  for (let i = 0; i < w * h; i++) fn(i);
}

/** Unpremultiplied copy helper: value of channel c at i. */
const un = (im, c, i) => (im.a[i] > 0 ? im[c][i] / im.a[i] : 0);

const BLEND = {
  normal: (cb, cs) => cs,
  multiply: (cb, cs) => cb * cs,
  screen: (cb, cs) => cb + cs - cb * cs,
  darken: Math.min,
  lighten: Math.max,
  overlay: (cb, cs) => (cb <= 0.5 ? 2 * cb * cs : 1 - 2 * (1 - cb) * (1 - cs)),
  'hard-light': (cb, cs) => (cs <= 0.5 ? 2 * cb * cs : 1 - 2 * (1 - cb) * (1 - cs)),
  'color-dodge': (cb, cs) => (cb === 0 ? 0 : cs >= 1 ? 1 : Math.min(1, cb / (1 - cs))),
  'color-burn': (cb, cs) => (cb >= 1 ? 1 : cs <= 0 ? 0 : 1 - Math.min(1, (1 - cb) / cs)),
  'soft-light': (cb, cs) => {
    if (cs <= 0.5) return cb - (1 - 2 * cs) * cb * (1 - cb);
    const d = cb <= 0.25 ? ((16 * cb - 12) * cb + 4) * cb : Math.sqrt(cb);
    return cb + (2 * cs - 1) * (d - cb);
  },
  difference: (cb, cs) => Math.abs(cb - cs),
  exclusion: (cb, cs) => cb + cs - 2 * cb * cs,
};

function lightingColor(a, isLin) {
  const c = parseColor(a['lighting-color'], [1, 1, 1, 1]);
  return isLin ? [lin(c[0]), lin(c[1]), lin(c[2])] : c.slice(0, 3);
}

function floodOf(a, isLin) {
  const c = parseColor(a['flood-color'], [0, 0, 0, 1]);
  const op = clamp01(num(a['flood-opacity'], 1)) * c[3];
  const col = isLin ? [lin(c[0]), lin(c[1]), lin(c[2])] : c.slice(0, 3);
  return [col[0] * op, col[1] * op, col[2] * op, op];
}

/** Separable min/max of every channel over a (2rx+1) x (2ry+1) window. */
function morph(im, rx, ry, dilate) {
  const { w, h } = im;
  const out = blank(w, h, im.lin);
  const pick = dilate ? Math.max : Math.min;
  for (const c of CH) {
    const s = im[c];
    const tmp = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let v = dilate ? 0 : 1;
        for (let i = x - rx; i <= x + rx; i++) v = pick(v, i < 0 || i >= w ? 0 : s[y * w + i]);
        tmp[y * w + x] = v;
      }
    }
    const o = out[c];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let v = dilate ? 0 : 1;
        for (let j = y - ry; j <= y + ry; j++) v = pick(v, j < 0 || j >= h ? 0 : tmp[j * w + x]);
        o[y * w + x] = v;
      }
    }
  }
  return out;
}

function shift(im, dx, dy) {
  const { w, h } = im;
  const out = blank(w, h, im.lin);
  for (const c of CH) {
    const s = im[c];
    const o = out[c];
    let i = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++, i++) o[i] = sampleZero(s, w, h, x - dx, y - dy);
  }
  return out;
}

function blur(im, sx, sy) {
  const out = blank(im.w, im.h, im.lin);
  for (const c of CH) out[c] = gauss(im[c], im.w, im.h, sx, sy);
  return out;
}

/** Surface normal (spec Sobel kernels) of alpha at pixel (x, y), scaled per user unit by k. */
function normalAt(A, w, h, x, y, ss, k) {
  const at = (i, j) => A[Math.min(h - 1, Math.max(0, j)) * w + Math.min(w - 1, Math.max(0, i))];
  const nx = -ss * k * 0.25 * (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1));
  const ny = -ss * k * 0.25 * (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1));
  return [nx, ny];
}

function lighting(im, p, specular, ctx, isLin) {
  const a = p.attrs;
  const { w, h } = im;
  const out = blank(w, h, isLin);
  const ss = num(a.surfaceScale, 1);
  const kd = num(specular ? a.specularConstant : a.diffuseConstant, 1);
  const se = num(a.specularExponent, 1);
  const lc = lightingColor(a, isLin);
  const light = p.children.find((c) => c.type === 'feDistantLight' || c.type === 'fePointLight' || c.type === 'feSpotLight');
  const la = light?.attrs || {};
  const toPx = (X, Y) => [X * ctx.k - ctx.ox - 0.5, Y * ctx.k - ctx.oy - 0.5];
  let dist = null;
  if (!light || light.type === 'feDistantLight') {
    const az = (num(la.azimuth, 0) * Math.PI) / 180;
    const el = (num(la.elevation, 0) * Math.PI) / 180;
    dist = [Math.cos(az) * Math.cos(el), Math.sin(az) * Math.cos(el), Math.sin(el)];
  }
  const [lx, ly] = light && light.type !== 'feDistantLight' ? toPx(num(la.x), num(la.y)) : [0, 0];
  const lz = num(la.z) * ctx.k;
  let S = null;
  let cone = null;
  if (light?.type === 'feSpotLight') {
    const [px, py] = toPx(num(la.pointsAtX), num(la.pointsAtY));
    const pz = num(la.pointsAtZ) * ctx.k;
    const d = [px - lx, py - ly, pz - lz];
    const n = Math.hypot(...d) || 1;
    S = d.map((v) => v / n);
    if (la.limitingConeAngle != null) cone = Math.cos((Math.abs(num(la.limitingConeAngle)) * Math.PI) / 180);
  }
  const spotExp = num(la.specularExponent, 1);
  let i = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++, i++) {
      const [nx, ny] = normalAt(im.a, w, h, x, y, ss, ctx.k);
      const nl = Math.hypot(nx, ny, 1);
      const N = [nx / nl, ny / nl, 1 / nl];
      let L = dist;
      let col = lc;
      if (!L) {
        const z = ss * im.a[i] * ctx.k;
        const v = [lx - x, ly - y, lz - z];
        const n = Math.hypot(...v) || 1;
        L = v.map((q) => q / n);
        if (S) {
          const md = -(L[0] * S[0] + L[1] * S[1] + L[2] * S[2]);
          const f = md <= 0 || (cone != null && md < cone) ? 0 : md ** spotExp;
          col = lc.map((c) => c * f);
        }
      }
      let f;
      if (specular) {
        const H = [L[0], L[1], L[2] + 1];
        const hn = Math.hypot(...H) || 1;
        f = kd * Math.max(0, (N[0] * H[0] + N[1] * H[1] + N[2] * H[2]) / hn) ** se;
      } else f = kd * Math.max(0, N[0] * L[0] + N[1] * L[1] + N[2] * L[2]);
      const r = clamp01(f * col[0]);
      const g = clamp01(f * col[1]);
      const b = clamp01(f * col[2]);
      if (specular) {
        const al = Math.max(r, g, b);
        out.r[i] = r;
        out.g[i] = g;
        out.b[i] = b;
        out.a[i] = al;
      } else {
        out.r[i] = r;
        out.g[i] = g;
        out.b[i] = b;
        out.a[i] = 1;
      }
    }
  }
  return out;
}

function transferFn(f) {
  if (!f) return null;
  const a = f.attrs;
  const type = a.type || 'identity';
  const tv = nums(a.tableValues);
  if (type === 'table' && tv.length) {
    const n = tv.length - 1;
    return (c) => {
      if (n === 0) return tv[0];
      const k = Math.min(n - 1, Math.floor(c * n));
      return tv[k] + (c * n - k) * (tv[k + 1] - tv[k]);
    };
  }
  if (type === 'discrete' && tv.length) return (c) => tv[Math.min(tv.length - 1, Math.floor(c * tv.length))];
  if (type === 'linear') {
    const s = num(a.slope, 1);
    const o = num(a.intercept, 0);
    return (c) => s * c + o;
  }
  if (type === 'gamma') {
    const amp = num(a.amplitude, 1);
    const ex = num(a.exponent, 1);
    const off = num(a.offset, 0);
    return (c) => amp * c ** ex + off;
  }
  return null;
}

function colorMatrix(im, a) {
  const type = a.type || 'matrix';
  let M;
  if (type === 'saturate') {
    const s = num(a.values, 1);
    M = [0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s, 0, 0, 0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s, 0, 0, 0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s, 0, 0, 0, 0, 0, 1, 0];
  } else if (type === 'hueRotate') {
    const r = (num(a.values, 0) * Math.PI) / 180;
    const c = Math.cos(r);
    const s = Math.sin(r);
    M = [
      0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928, 0, 0,
      0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.14, 0.072 - c * 0.072 - s * 0.283, 0, 0,
      0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072, 0, 0,
      0, 0, 0, 1, 0,
    ];
  } else if (type === 'luminanceToAlpha') {
    M = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.2125, 0.7154, 0.0721, 0, 0];
  } else {
    const v = nums(a.values);
    M = v.length === 20 ? v : [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0];
  }
  const out = blank(im.w, im.h, im.lin);
  each(im.w, im.h, (i) => {
    const r = un(im, 'r', i);
    const g = un(im, 'g', i);
    const b = un(im, 'b', i);
    const al = im.a[i];
    const o = [0, 1, 2, 3].map((k) => clamp01(M[k * 5] * r + M[k * 5 + 1] * g + M[k * 5 + 2] * b + M[k * 5 + 3] * al + M[k * 5 + 4]));
    out.r[i] = o[0] * o[3];
    out.g[i] = o[1] * o[3];
    out.b[i] = o[2] * o[3];
    out.a[i] = o[3];
  });
  return out;
}

function composite(A, B, a) {
  const op = a.operator || 'over';
  const out = blank(A.w, A.h, A.lin);
  const k = [num(a.k1), num(a.k2), num(a.k3), num(a.k4)];
  each(A.w, A.h, (i) => {
    const as = A.a[i];
    const ab = B.a[i];
    for (const c of CH) {
      const s = A[c][i];
      const d = B[c][i];
      let v;
      switch (op) {
        case 'in':
          v = s * ab;
          break;
        case 'out':
          v = s * (1 - ab);
          break;
        case 'atop':
          v = s * ab + d * (1 - as);
          break;
        case 'xor':
          v = s * (1 - ab) + d * (1 - as);
          break;
        case 'lighter':
          v = s + d;
          break;
        case 'arithmetic':
          v = k[0] * s * d + k[1] * s + k[2] * d + k[3];
          break;
        default:
          v = s + d * (1 - as);
      }
      out[c][i] = clamp01(v);
    }
    // Arithmetic results stay premultiplied: color cannot exceed alpha.
    if (op === 'arithmetic') for (const c of ['r', 'g', 'b']) out[c][i] = Math.min(out[c][i], out.a[i]);
  });
  return out;
}

function blend(A, B, mode) {
  const fn = BLEND[mode] || BLEND.normal;
  const out = blank(A.w, A.h, A.lin);
  each(A.w, A.h, (i) => {
    const as = A.a[i];
    const ab = B.a[i];
    out.a[i] = as + ab - as * ab;
    for (const c of ['r', 'g', 'b']) {
      const cs = as > 0 ? A[c][i] / as : 0;
      const cb = ab > 0 ? B[c][i] / ab : 0;
      out[c][i] = clamp01((1 - ab) * A[c][i] + (1 - as) * B[c][i] + as * ab * fn(cb, cs));
    }
  });
  return out;
}

function convolve(im, a) {
  const [ox, oy = ox] = nums(a.order).length ? nums(a.order) : [3];
  const km = nums(a.kernelMatrix);
  if (km.length !== ox * oy) return im;
  const sum = km.reduce((s, v) => s + v, 0);
  const div = num(a.divisor, sum || 1) || 1;
  const bias = num(a.bias, 0);
  const tx = a.targetX != null ? num(a.targetX) : Math.floor(ox / 2);
  const ty = a.targetY != null ? num(a.targetY) : Math.floor(oy / 2);
  const edge = a.edgeMode || 'duplicate';
  const keepA = a.preserveAlpha === 'true';
  const { w, h } = im;
  const out = blank(w, h, im.lin);
  const src = {};
  for (const c of CH) src[c] = keepA && c !== 'a' ? im[c].map((v, i) => (im.a[i] > 0 ? v / im.a[i] : 0)) : im[c];
  const at = (p, x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) {
      if (edge === 'none') return 0;
      if (edge === 'wrap') {
        x = ((x % w) + w) % w;
        y = ((y % h) + h) % h;
      } else {
        x = Math.min(w - 1, Math.max(0, x));
        y = Math.min(h - 1, Math.max(0, y));
      }
    }
    return p[y * w + x];
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      for (const c of CH) {
        if (keepA && c === 'a') {
          out.a[i] = im.a[i];
          continue;
        }
        let s = 0;
        for (let j = 0; j < oy; j++) for (let q = 0; q < ox; q++) s += at(src[c], x - tx + q, y - ty + j) * km[(oy - 1 - j) * ox + (ox - 1 - q)];
        out[c][i] = s / div + bias;
      }
      if (keepA) for (const c of ['r', 'g', 'b']) out[c][i] = clamp01(out[c][i]) * out.a[i];
      else {
        out.a[i] = clamp01(out.a[i]);
        for (const c of ['r', 'g', 'b']) out[c][i] = Math.min(clamp01(out[c][i]), out.a[i]);
      }
    }
  }
  return out;
}

// ---- running a filter ----

/**
 * Render a compiled filter. `img` is the source graphic (straight color),
 * ctx: { k, ox, oy, seed, docBounds } (see core.js). Returns an image of
 * the same size.
 */
export function renderFilter(img, f, ctx) {
  const { w, h } = img;
  const b = ctx.docBounds || { x: docX(ctx, 0) - 0.5 / ctx.k, y: docY(ctx, 0) - 0.5 / ctx.k, w: w / ctx.k, h: h / ctx.k };
  const bw = b.w || 1;
  const bh = b.h || 1;
  const region = filterRegion(f, b);
  const toPxRect = (r) => ({ x: r.x * ctx.k - ctx.ox, y: r.y * ctx.k - ctx.oy, w: r.w * ctx.k, h: r.h * ctx.k });
  const regionPx = toPxRect(region);
  const bbox = f.attrs.primitiveUnits === 'objectBoundingBox';
  // Lengths: user units (document points) or fractions of the bounds.
  const lenX = (v) => (bbox ? v * bw : v) * ctx.k;
  const lenY = (v) => (bbox ? v * bh : v) * ctx.k;
  const filterCif = f.attrs['color-interpolation-filters'] || 'linearRGB';

  const source = blank(w, h, false);
  for (let i = 0; i < w * h; i++) {
    const a = img.a[i];
    source.r[i] = img.r[i] * a;
    source.g[i] = img.g[i] * a;
    source.b[i] = img.b[i] * a;
    source.a[i] = a;
  }
  const results = new Map();
  let last = source;
  let sourceAlpha = null;
  const input = (name, isLin) => {
    let im;
    if (!name) im = last;
    else if (name === 'SourceGraphic') im = source;
    else if (name === 'SourceAlpha') {
      if (!sourceAlpha) {
        sourceAlpha = blank(w, h, false);
        sourceAlpha.a.set(source.a);
      }
      im = sourceAlpha;
    } else if (results.has(name)) im = results.get(name);
    else if (/^(BackgroundImage|BackgroundAlpha|FillPaint|StrokePaint)$/.test(name)) im = blank(w, h, isLin);
    else im = last;
    return convert(im, isLin);
  };

  for (const p of f.prims) {
    const a = p.attrs;
    const cif = a['color-interpolation-filters'] || filterCif;
    const isLin = cif !== 'sRGB';
    let out;
    switch (p.type) {
      case 'feGaussianBlur': {
        const [sx = 0, sy = sx] = nums(a.stdDeviation);
        out = blur(input(a.in, isLin), lenX(sx), lenY(sy));
        break;
      }
      case 'feOffset':
        out = shift(input(a.in, isLin), lenX(num(a.dx)), lenY(num(a.dy)));
        break;
      case 'feDropShadow': {
        const src = input(a.in, isLin);
        const [sx = 2, sy = sx] = a.stdDeviation != null ? nums(a.stdDeviation) : [2];
        const sh = shift(blur(src, lenX(sx), lenY(sy)), lenX(num(a.dx, 2)), lenY(num(a.dy, 2)));
        const fl = floodOf(a, isLin);
        const tint = blank(w, h, isLin);
        each(w, h, (i) => {
          for (let c = 0; c < 4; c++) tint[CH[c]][i] = fl[c] * sh.a[i];
        });
        out = composite(src, tint, { operator: 'over' });
        break;
      }
      case 'feFlood': {
        const fl = floodOf(a, isLin);
        out = blank(w, h, isLin);
        for (let c = 0; c < 4; c++) out[CH[c]].fill(fl[c]);
        break;
      }
      case 'feComposite':
        out = composite(input(a.in, isLin), input(a.in2, isLin), a);
        break;
      case 'feBlend':
        out = blend(input(a.in, isLin), input(a.in2, isLin), a.mode || 'normal');
        break;
      case 'feMerge': {
        out = blank(w, h, isLin);
        for (const n of p.children) if (n.type === 'feMergeNode') out = composite(input(n.attrs.in, isLin), out, { operator: 'over' });
        break;
      }
      case 'feColorMatrix':
        out = colorMatrix(input(a.in, isLin), a);
        break;
      case 'feComponentTransfer': {
        const src = input(a.in, isLin);
        const fns = { r: 'feFuncR', g: 'feFuncG', b: 'feFuncB', a: 'feFuncA' };
        const T = {};
        for (const c of CH) T[c] = transferFn(p.children.find((k) => k.type === fns[c]));
        out = blank(w, h, isLin);
        each(w, h, (i) => {
          const al = clamp01(T.a ? T.a(src.a[i]) : src.a[i]);
          out.a[i] = al;
          for (const c of ['r', 'g', 'b']) {
            const v = un(src, c, i);
            out[c][i] = clamp01(T[c] ? T[c](v) : v) * al;
          }
        });
        break;
      }
      case 'feMorphology': {
        const [rx = 0, ry = rx] = nums(a.radius);
        const src = input(a.in, isLin);
        out = rx > 0 || ry > 0 ? morph(src, Math.round(lenX(rx)), Math.round(lenY(ry)), a.operator === 'dilate') : src;
        break;
      }
      case 'feConvolveMatrix':
        out = convolve(input(a.in, isLin), a);
        break;
      case 'feTurbulence': {
        const [fx = 0, fy = fx] = nums(a.baseFrequency);
        const T = turbulenceTables(num(a.seed, 0));
        const oct = Math.max(0, Math.min(10, Math.round(num(a.numOctaves, 1))));
        const fractal = a.type === 'fractalNoise';
        const tile = a.stitchTiles === 'stitch' ? region : null;
        // Frequencies are per user unit; with bounding-box units, per bounds size.
        const ffx = bbox ? fx / bw : fx;
        const ffy = bbox ? fy / bh : fy;
        out = blank(w, h, isLin);
        let i = 0;
        for (let y = 0; y < h; y++) {
          const Y = docY(ctx, y);
          for (let x = 0; x < w; x++, i++) {
            const X = docX(ctx, x);
            const v = [0, 1, 2, 3].map((ch) => {
              const t = turbulence(T, ch, X, Y, ffx, ffy, oct, fractal, tile);
              return clamp01(fractal ? (t + 1) / 2 : t);
            });
            out.a[i] = v[3];
            out.r[i] = v[0] * v[3];
            out.g[i] = v[1] * v[3];
            out.b[i] = v[2] * v[3];
          }
        }
        break;
      }
      case 'feDisplacementMap': {
        const src = input(a.in, isLin);
        const map = input(a.in2, isLin);
        const sc = num(a.scale, 0);
        const sxs = lenX(sc);
        const sys = lenY(sc);
        const chan = (s) => ({ R: 'r', G: 'g', B: 'b', A: 'a' })[s] || 'a';
        const xc = chan(a.xChannelSelector);
        const yc = chan(a.yChannelSelector);
        out = blank(w, h, isLin);
        let i = 0;
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++, i++) {
            const vx = xc === 'a' ? map.a[i] : un(map, xc, i);
            const vy = yc === 'a' ? map.a[i] : un(map, yc, i);
            const sx = x + sxs * (vx - 0.5);
            const sy = y + sys * (vy - 0.5);
            for (const c of CH) out[c][i] = sampleZero(src[c], w, h, sx, sy);
          }
        }
        break;
      }
      case 'feTile': {
        const src = input(a.in, isLin);
        const s = src.sub || { x: 0, y: 0, w, h };
        out = blank(w, h, isLin);
        if (s.w >= 1 && s.h >= 1) {
          let i = 0;
          for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++, i++) {
              const tx = s.x + ((((x - s.x) % s.w) + s.w) % s.w);
              const ty = s.y + ((((y - s.y) % s.h) + s.h) % s.h);
              for (const c of CH) out[c][i] = sample(src[c], w, h, tx, ty);
            }
          }
        }
        break;
      }
      case 'feDiffuseLighting':
      case 'feSpecularLighting':
        out = lighting(input(a.in, isLin), p, p.type === 'feSpecularLighting', ctx, isLin);
        break;
      default:
        out = blank(w, h, isLin);
    }
    // Primitive subregion: explicit x/y/width/height, else the filter region.
    let sub = regionPx;
    if (a.x != null || a.y != null || a.width != null || a.height != null) {
      const v = (s, base, size, d) => (s == null ? d : bbox ? base + frac(s, 0) * size : String(s).endsWith('%') ? d : num(s));
      const vs = (s, size, d) => (s == null ? d : bbox ? frac(s, 1) * size : String(s).endsWith('%') ? d : num(s));
      sub = toPxRect({ x: v(a.x, b.x, bw, region.x), y: v(a.y, b.y, bh, region.y), w: vs(a.width, bw, region.w), h: vs(a.height, bh, region.h) });
    }
    clip(out, sub);
    out.sub = sub;
    if (a.result) results.set(a.result, out);
    last = out;
  }
  const fin = convert(last, false);
  clip(fin, regionPx);
  const res = createImg(w, h);
  for (let i = 0; i < w * h; i++) {
    const al = clamp01(fin.a[i]);
    res.a[i] = al;
    res.r[i] = al > 0 ? clamp01(fin.r[i] / al) : img.r[i];
    res.g[i] = al > 0 ? clamp01(fin.g[i] / al) : img.g[i];
    res.b[i] = al > 0 ? clamp01(fin.b[i] / al) : img.b[i];
  }
  return res;
}

/** Clear everything outside rect r (work px), with partial coverage on its edges. */
function clip(im, r) {
  const { w, h } = im;
  const x0 = r.x;
  const y0 = r.y;
  const x1 = r.x + r.w;
  const y1 = r.y + r.h;
  if (x0 <= 0 && y0 <= 0 && x1 >= w && y1 >= h) return;
  let i = 0;
  for (let y = 0; y < h; y++) {
    const cy = clamp01(Math.min(y + 1, y1) - Math.max(y, y0));
    for (let x = 0; x < w; x++, i++) {
      const cv = cy * clamp01(Math.min(x + 1, x1) - Math.max(x, x0));
      if (cv >= 1) continue;
      for (const c of CH) im[c][i] *= cv;
    }
  }
}
