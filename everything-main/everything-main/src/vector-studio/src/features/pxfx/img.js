/**
 * Float images for the pixel effects and the image-processing building
 * blocks the filters share (blurs, edges, sampling, deterministic noise,
 * cell patterns).
 *
 * An image is { w, h, r, g, b, a } with straight (not premultiplied) color
 * in 0..1. Colors of transparent pixels are filled from their surroundings
 * when an image is read (see fromRGBA), so neighborhood filters do not pull
 * black into the edges of an object.
 */

export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export function smoothstep(e0, e1, x) {
  const t = clamp01((x - e0) / (e1 - e0 || 1e-9));
  return t * t * (3 - 2 * t);
}

export function createImg(w, h) {
  const n = w * h;
  return { w, h, r: new Float32Array(n), g: new Float32Array(n), b: new Float32Array(n), a: new Float32Array(n) };
}

export function cloneImg(img) {
  return { w: img.w, h: img.h, r: img.r.slice(), g: img.g.slice(), b: img.b.slice(), a: img.a.slice() };
}

/** Same size and alpha as `img`, color left to the caller. */
export function likeImg(img) {
  const out = createImg(img.w, img.h);
  out.a.set(img.a);
  return out;
}

/** '#rrggbb' -> [r, g, b] in 0..1. */
export function hexRgb(hex) {
  const n = parseInt(String(hex || '#000000').slice(1), 16) || 0;
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** An image from RGBA bytes (straight alpha), with colors bled into transparent pixels. */
export function fromRGBA(data, w, h) {
  const img = createImg(w, h);
  const { r, g, b, a } = img;
  let sr = 0;
  let sg = 0;
  let sb = 0;
  let sa = 0;
  let clear = 0;
  for (let i = 0, j = 0; i < w * h; i++, j += 4) {
    const al = data[j + 3] / 255;
    r[i] = data[j] / 255;
    g[i] = data[j + 1] / 255;
    b[i] = data[j + 2] / 255;
    a[i] = al;
    sr += r[i] * al;
    sg += g[i] * al;
    sb += b[i] * al;
    sa += al;
    if (al < 1 / 255) clear++;
  }
  if (clear && sa > 0) bleed(img, [sr / sa, sg / sa, sb / sa]);
  return img;
}

/** Fill the color of transparent pixels from nearby content (alpha-weighted blur), else `fallback`. */
function bleed(img, fallback) {
  const { w, h, r, g, b, a } = img;
  const n = w * h;
  const pr = new Float32Array(n);
  const pg = new Float32Array(n);
  const pb = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    pr[i] = r[i] * a[i];
    pg[i] = g[i] * a[i];
    pb[i] = b[i] * a[i];
  }
  const s = Math.max(2, Math.min(24, Math.round(Math.min(w, h) / 16)));
  const br = gauss(pr, w, h, s);
  const bg = gauss(pg, w, h, s);
  const bb = gauss(pb, w, h, s);
  const ba = gauss(a, w, h, s);
  for (let i = 0; i < n; i++) {
    if (a[i] >= 1 / 255) continue;
    const q = ba[i];
    if (q > 1e-4) {
      r[i] = clamp01(br[i] / q);
      g[i] = clamp01(bg[i] / q);
      b[i] = clamp01(bb[i] / q);
    } else {
      r[i] = fallback[0];
      g[i] = fallback[1];
      b[i] = fallback[2];
    }
  }
}

/** RGBA bytes (straight alpha) from an image. */
export function toRGBA(img, out = new Uint8ClampedArray(img.w * img.h * 4)) {
  const { r, g, b, a } = img;
  for (let i = 0, j = 0; i < r.length; i++, j += 4) {
    out[j] = r[i] * 255;
    out[j + 1] = g[i] * 255;
    out[j + 2] = b[i] * 255;
    out[j + 3] = a[i] * 255;
  }
  return out;
}

/** Rec. 601 luminance plane. */
export function lum(img) {
  const { r, g, b } = img;
  const out = new Float32Array(r.length);
  for (let i = 0; i < r.length; i++) out[i] = 0.299 * r[i] + 0.587 * g[i] + 0.114 * b[i];
  return out;
}

// ---- blurs ----

/** One box blur pass of radius r along rows (horizontal) or columns, edges clamped. */
function boxPass(src, dst, w, h, r, horizontal) {
  const len = horizontal ? w : h;
  const lines = horizontal ? h : w;
  const step = horizontal ? 1 : w;
  const inv = 1 / (2 * r + 1);
  for (let l = 0; l < lines; l++) {
    const base = horizontal ? l * w : l;
    let acc = src[base] * (r + 1);
    for (let i = 1; i <= r; i++) acc += src[base + Math.min(i, len - 1) * step];
    for (let i = 0; i < len; i++) {
      dst[base + i * step] = acc * inv;
      const add = Math.min(i + r + 1, len - 1);
      const sub = Math.max(i - r, 0);
      acc += src[base + add * step] - src[base + sub * step];
    }
  }
}

/** Box radii whose three passes approximate a Gaussian of standard deviation sigma. */
function boxRadii(sigma) {
  const ideal = Math.sqrt((12 * sigma * sigma) / 3 + 1);
  let wl = Math.floor(ideal);
  if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const m = Math.round((12 * sigma * sigma - 3 * wl * wl - 12 * wl - 9) / (-4 * wl - 4));
  return [0, 1, 2].map((i) => ((i < m ? wl : wu) - 1) / 2);
}

/**
 * Gaussian blur of a plane (three box passes each way), with its own
 * deviation across (sigma) and down (sigmaY); returns a new plane.
 */
export function gauss(src, w, h, sigma, sigmaY = sigma) {
  const out = Float32Array.from(src);
  if (w < 1 || h < 1) return out;
  const tmp = new Float32Array(src.length);
  if (sigma > 0.3 && w > 1) {
    for (const r of boxRadii(Math.min(sigma, w))) {
      if (r < 1) continue;
      boxPass(out, tmp, w, h, r, true);
      out.set(tmp);
    }
  }
  if (sigmaY > 0.3 && h > 1) {
    for (const r of boxRadii(Math.min(sigmaY, h))) {
      if (r < 1) continue;
      boxPass(out, tmp, w, h, r, false);
      out.set(tmp);
    }
  }
  return out;
}

/** Box blur of a plane with radius r (one pass each way). */
export function boxBlur(src, w, h, r) {
  const out = Float32Array.from(src);
  if (r < 1) return out;
  const tmp = new Float32Array(src.length);
  boxPass(out, tmp, w, h, r, true);
  boxPass(tmp, out, w, h, r, false);
  return out;
}

/** Gaussian blur of an image's color and alpha (premultiplied, so edges stay clean). */
export function blurImg(img, sigma) {
  if (!(sigma > 0.3)) return cloneImg(img);
  const { w, h, r, g, b, a } = img;
  const n = w * h;
  const pr = new Float32Array(n);
  const pg = new Float32Array(n);
  const pb = new Float32Array(n);
  // A small floor keeps the bled color of transparent pixels in the average.
  const wa = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const q = a[i] + 1e-3;
    wa[i] = q;
    pr[i] = r[i] * q;
    pg[i] = g[i] * q;
    pb[i] = b[i] * q;
  }
  const br = gauss(pr, w, h, sigma);
  const bg = gauss(pg, w, h, sigma);
  const bb = gauss(pb, w, h, sigma);
  const bw = gauss(wa, w, h, sigma);
  const out = createImg(w, h);
  for (let i = 0; i < n; i++) {
    const q = bw[i];
    out.r[i] = br[i] / q;
    out.g[i] = bg[i] / q;
    out.b[i] = bb[i] / q;
    out.a[i] = clamp01(q - 1e-3);
  }
  return out;
}

/** Color blur that keeps alpha as it is. */
export function blurColor(img, sigma) {
  const out = blurImg(img, sigma);
  out.a.set(img.a);
  return out;
}

/** img + (img - blurred) * amount, per color channel. */
export function sharpen(img, sigma, amount) {
  if (!(amount > 0)) return img;
  const bl = blurColor(img, sigma);
  const out = likeImg(img);
  for (const c of ['r', 'g', 'b']) {
    const s = img[c];
    const d = bl[c];
    const o = out[c];
    for (let i = 0; i < s.length; i++) o[i] = clamp01(s[i] + (s[i] - d[i]) * amount);
  }
  return out;
}

/** Sobel gradient of a plane: { gx, gy, mag }. */
export function sobel(p, w, h) {
  const n = w * h;
  const gx = new Float32Array(n);
  const gy = new Float32Array(n);
  const mag = new Float32Array(n);
  for (let y = 0; y < h; y++) {
    const ym = (y > 0 ? y - 1 : 0) * w;
    const y0 = y * w;
    const yp = (y < h - 1 ? y + 1 : h - 1) * w;
    for (let x = 0; x < w; x++) {
      const xm = x > 0 ? x - 1 : 0;
      const xp = x < w - 1 ? x + 1 : w - 1;
      const sx = (p[ym + xp] + 2 * p[y0 + xp] + p[yp + xp] - p[ym + xm] - 2 * p[y0 + xm] - p[yp + xm]) / 8;
      const sy = (p[yp + xm] + 2 * p[yp + x] + p[yp + xp] - p[ym + xm] - 2 * p[ym + x] - p[ym + xp]) / 8;
      const i = y0 + x;
      gx[i] = sx;
      gy[i] = sy;
      mag[i] = Math.sqrt(sx * sx + sy * sy);
    }
  }
  return { gx, gy, mag };
}

/** Bilinear sample of a plane with clamped edges. */
export function sample(p, w, h, x, y) {
  x = x < 0 ? 0 : x > w - 1 ? w - 1 : x;
  y = y < 0 ? 0 : y > h - 1 ? h - 1 : y;
  const x0 = x | 0;
  const y0 = y | 0;
  const x1 = x0 < w - 1 ? x0 + 1 : x0;
  const y1 = y0 < h - 1 ? y0 + 1 : y0;
  const fx = x - x0;
  const fy = y - y0;
  const a = p[y0 * w + x0];
  const b = p[y0 * w + x1];
  const c = p[y1 * w + x0];
  const d = p[y1 * w + x1];
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/** Bilinear sample of a plane that is 0 outside it (for alpha that moves). */
export function sampleZero(p, w, h, x, y) {
  if (x <= -1 || y <= -1 || x >= w || y >= h) return 0;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const inX0 = x0 >= 0;
  const inX1 = x1 < w;
  const r0 = y0 >= 0 ? y0 * w : -1;
  const r1 = y1 < h ? y1 * w : -1;
  const a = r0 >= 0 && inX0 ? p[r0 + x0] : 0;
  const b = r0 >= 0 && inX1 ? p[r0 + x1] : 0;
  const c = r1 >= 0 && inX0 ? p[r1 + x0] : 0;
  const d = r1 >= 0 && inX1 ? p[r1 + x1] : 0;
  return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
}

/**
 * Resample every channel at displaced positions: map(x, y) -> [sx, sy].
 * Alpha outside the image is transparent; color is clamped.
 */
export function displace(img, map) {
  const { w, h } = img;
  const out = createImg(w, h);
  let i = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++, i++) {
      const [sx, sy] = map(x, y);
      out.r[i] = sample(img.r, w, h, sx, sy);
      out.g[i] = sample(img.g, w, h, sx, sy);
      out.b[i] = sample(img.b, w, h, sx, sy);
      out.a[i] = sampleZero(img.a, w, h, sx, sy);
    }
  }
  return out;
}

/**
 * Average of the image along a line through each pixel (direction dx, dy,
 * total length len px), premultiplied.
 */
export function dirBlur(img, dx, dy, len) {
  const { w, h } = img;
  const d = Math.hypot(dx, dy) || 1;
  const ux = dx / d;
  const uy = dy / d;
  const steps = Math.max(1, Math.min(24, Math.round(len)));
  if (len < 1) return cloneImg(img);
  const out = createImg(w, h);
  const offs = [];
  for (let s = 0; s <= steps; s++) {
    const t = (s / steps - 0.5) * len;
    offs.push([ux * t, uy * t]);
  }
  let i = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++, i++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (const [ox, oy] of offs) {
        const sx = x + ox;
        const sy = y + oy;
        const q = sample(img.a, w, h, sx, sy) + 1e-3;
        r += sample(img.r, w, h, sx, sy) * q;
        g += sample(img.g, w, h, sx, sy) * q;
        b += sample(img.b, w, h, sx, sy) * q;
        a += q;
      }
      out.r[i] = r / a;
      out.g[i] = g / a;
      out.b[i] = b / a;
      out.a[i] = img.a[i];
    }
  }
  return out;
}

/** Summed-area table of a plane ((w+1) x (h+1)). */
function integral(p, w, h, square = false) {
  const W = w + 1;
  const s = new Float64Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      const v = p[y * w + x];
      row += square ? v * v : v;
      s[(y + 1) * W + x + 1] = s[y * W + x + 1] + row;
    }
  }
  return s;
}

/**
 * Kuwahara smoothing: each pixel takes the mean color of whichever of the
 * four (r+1)-square quadrants around it varies least. Flattens areas into
 * paint-like patches while keeping their edges.
 */
export function kuwahara(img, r) {
  const { w, h } = img;
  if (r < 1) return cloneImg(img);
  const L = lum(img);
  const W = w + 1;
  const sl = integral(L, w, h);
  const sq = integral(L, w, h, true);
  const sr = integral(img.r, w, h);
  const sg = integral(img.g, w, h);
  const sb = integral(img.b, w, h);
  const box = (s, x0, y0, x1, y1) => s[(y1 + 1) * W + x1 + 1] - s[y0 * W + x1 + 1] - s[(y1 + 1) * W + x0] + s[y0 * W + x0];
  const out = likeImg(img);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let best = Infinity;
      let bx0 = 0;
      let by0 = 0;
      let bx1 = 0;
      let by1 = 0;
      for (let q = 0; q < 4; q++) {
        const x0 = q & 1 ? x : Math.max(0, x - r);
        const x1 = q & 1 ? Math.min(w - 1, x + r) : x;
        const y0 = q & 2 ? y : Math.max(0, y - r);
        const y1 = q & 2 ? Math.min(h - 1, y + r) : y;
        const n = (x1 - x0 + 1) * (y1 - y0 + 1);
        const m = box(sl, x0, y0, x1, y1) / n;
        const v = box(sq, x0, y0, x1, y1) / n - m * m;
        if (v < best) {
          best = v;
          bx0 = x0;
          by0 = y0;
          bx1 = x1;
          by1 = y1;
        }
      }
      const n = (bx1 - bx0 + 1) * (by1 - by0 + 1);
      const i = y * w + x;
      out.r[i] = box(sr, bx0, by0, bx1, by1) / n;
      out.g[i] = box(sg, bx0, by0, bx1, by1) / n;
      out.b[i] = box(sb, bx0, by0, bx1, by1) / n;
    }
  }
  return out;
}

/** Grow (dilate) a plane by a square of radius r: the max over the window. */
export function maxFilter(p, w, h, r) {
  if (r < 1) return Float32Array.from(p);
  const tmp = new Float32Array(p.length);
  const out = new Float32Array(p.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let m = -Infinity;
      for (let i = Math.max(0, x - r); i <= Math.min(w - 1, x + r); i++) m = Math.max(m, p[y * w + i]);
      tmp[y * w + x] = m;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let m = -Infinity;
      for (let j = Math.max(0, y - r); j <= Math.min(h - 1, y + r); j++) m = Math.max(m, tmp[j * w + x]);
      out[y * w + x] = m;
    }
  }
  return out;
}

// ---- deterministic noise ----

/** Hash of integer lattice coordinates and a seed -> [0, 1). */
export function hash2(x, y, seed = 0) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Smooth value noise in [0, 1) at continuous coordinates. */
export function noise2(x, y, seed = 0) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  let fx = x - x0;
  let fy = y - y0;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const a = hash2(x0, y0, seed);
  const b = hash2(x0 + 1, y0, seed);
  const c = hash2(x0, y0 + 1, seed);
  const d = hash2(x0 + 1, y0 + 1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/** Fractal value noise (octaves of noise2), in [0, 1). */
export function fbm(x, y, seed = 0, octaves = 4) {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let f = 1;
  for (let o = 0; o < octaves; o++) {
    sum += noise2(x * f, y * f, seed + o * 101) * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return sum / norm;
}

/**
 * Per-pixel document coordinates: a filter context maps work pixel (x, y)
 * to the document point ((x + ox + 0.5) / k, (y + oy + 0.5) / k), so
 * patterns stay attached to the artwork under any view.
 */
export const docX = (ctx, x) => (x + ctx.ox + 0.5) / ctx.k;
export const docY = (ctx, y) => (y + ctx.oy + 0.5) / ctx.k;

/** A plane computed from document coordinates: fn(X, Y, x, y). */
export function field(img, ctx, fn) {
  const { w, h } = img;
  const out = new Float32Array(w * h);
  let i = 0;
  for (let y = 0; y < h; y++) {
    const Y = docY(ctx, y);
    for (let x = 0; x < w; x++, i++) out[i] = fn(docX(ctx, x), Y, x, y);
  }
  return out;
}

/**
 * Jittered-grid Voronoi cells of `size` document units, anchored to the
 * document: { site: Int32Array (cell per pixel), d1, d2 (distances in work
 * px to the nearest and second nearest site), sx, sy (site positions in
 * work px) }.
 */
export function cells(img, ctx, size, seed = 0, jitter = 0.9) {
  const { w, h } = img;
  const c = Math.max(0.75, size * ctx.k);
  const i0 = Math.floor(ctx.ox / c) - 1;
  const j0 = Math.floor(ctx.oy / c) - 1;
  const ni = Math.floor((ctx.ox + w) / c) + 2 - i0;
  const nj = Math.floor((ctx.oy + h) / c) + 2 - j0;
  const sx = new Float32Array(ni * nj);
  const sy = new Float32Array(ni * nj);
  for (let j = 0; j < nj; j++) {
    for (let i = 0; i < ni; i++) {
      const gi = i + i0;
      const gj = j + j0;
      sx[j * ni + i] = (gi + 0.5 + (hash2(gi, gj, seed) - 0.5) * jitter) * c - ctx.ox;
      sy[j * ni + i] = (gj + 0.5 + (hash2(gi, gj, seed + 7) - 0.5) * jitter) * c - ctx.oy;
    }
  }
  const site = new Int32Array(w * h);
  const d1 = new Float32Array(w * h);
  const d2 = new Float32Array(w * h);
  let p = 0;
  for (let y = 0; y < h; y++) {
    const cj = Math.floor((y + ctx.oy) / c) - j0;
    for (let x = 0; x < w; x++, p++) {
      const ci = Math.floor((x + ctx.ox) / c) - i0;
      let b1 = Infinity;
      let b2 = Infinity;
      let bi = 0;
      for (let dj = -1; dj <= 1; dj++) {
        const jj = cj + dj;
        if (jj < 0 || jj >= nj) continue;
        for (let di = -1; di <= 1; di++) {
          const ii = ci + di;
          if (ii < 0 || ii >= ni) continue;
          const k = jj * ni + ii;
          const ex = sx[k] - x;
          const ey = sy[k] - y;
          const d = ex * ex + ey * ey;
          if (d < b1) {
            b2 = b1;
            b1 = d;
            bi = k;
          } else if (d < b2) b2 = d;
        }
      }
      site[p] = bi;
      d1[p] = Math.sqrt(b1);
      d2[p] = Math.sqrt(b2);
    }
  }
  return { site, d1, d2, sx, sy, cols: ni, rows: nj, size: c, i0, j0 };
}

/** Per-site colors sampled from the image at each site: { r, g, b, a } Float32Arrays. */
export function siteColors(img, cl) {
  const n = cl.sx.length;
  const out = { r: new Float32Array(n), g: new Float32Array(n), b: new Float32Array(n), a: new Float32Array(n) };
  for (let k = 0; k < n; k++) {
    const x = cl.sx[k];
    const y = cl.sy[k];
    out.r[k] = sample(img.r, img.w, img.h, x, y);
    out.g[k] = sample(img.g, img.w, img.h, x, y);
    out.b[k] = sample(img.b, img.w, img.h, x, y);
    out.a[k] = sampleZero(img.a, img.w, img.h, x, y);
  }
  return out;
}

/** Map each pixel's color through fn(r, g, b, i) -> [r, g, b] (alpha kept). */
export function mapColor(img, fn) {
  const out = likeImg(img);
  for (let i = 0; i < img.r.length; i++) {
    const c = fn(img.r[i], img.g[i], img.b[i], i);
    out.r[i] = clamp01(c[0]);
    out.g[i] = clamp01(c[1]);
    out.b[i] = clamp01(c[2]);
  }
  return out;
}

/** Ink/paper rendering: t = 0 is ink, 1 is paper (alpha kept). */
export function inkPaper(img, t, ink, paper) {
  const I = hexRgb(ink);
  const P = hexRgb(paper);
  const out = likeImg(img);
  for (let i = 0; i < t.length; i++) {
    const v = clamp01(t[i]);
    out.r[i] = I[0] + (P[0] - I[0]) * v;
    out.g[i] = I[1] + (P[1] - I[1]) * v;
    out.b[i] = I[2] + (P[2] - I[2]) * v;
  }
  return out;
}

/** Light direction presets (unit vectors pointing toward the light, y down). */
export const LIGHT_DIRS = [
  { value: 'bottom', label: 'Bottom', v: [0, 1] },
  { value: 'bottomLeft', label: 'Bottom Left', v: [-Math.SQRT1_2, Math.SQRT1_2] },
  { value: 'left', label: 'Left', v: [-1, 0] },
  { value: 'topLeft', label: 'Top Left', v: [-Math.SQRT1_2, -Math.SQRT1_2] },
  { value: 'top', label: 'Top', v: [0, -1] },
  { value: 'topRight', label: 'Top Right', v: [Math.SQRT1_2, -Math.SQRT1_2] },
  { value: 'right', label: 'Right', v: [1, 0] },
  { value: 'bottomRight', label: 'Bottom Right', v: [Math.SQRT1_2, Math.SQRT1_2] },
];
export const lightVec = (id) => (LIGHT_DIRS.find((d) => d.value === id) || LIGHT_DIRS[3]).v;

/**
 * Relief shading of a height plane (0..1) lit from `dir`: 0.5 is flat,
 * brighter facing the light. `gain` scales slopes (height per document unit).
 */
export function shade(H, w, h, k, dir, gain) {
  const { gx, gy } = sobel(H, w, h);
  const out = new Float32Array(w * h);
  const s = gain * k * 4;
  for (let i = 0; i < out.length; i++) {
    const nx = -gx[i] * s;
    const ny = -gy[i] * s;
    const len = Math.sqrt(nx * nx + ny * ny + 1);
    // Light 45 degrees above the surface in direction dir.
    const d = (nx * dir[0] + ny * dir[1] + 1) / (len * Math.SQRT2);
    out[i] = clamp01(0.5 + (d - Math.SQRT1_2) * 1.6);
  }
  return out;
}
