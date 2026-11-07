// Gaussian approximation by three successive box blurs (central limit), with
// box widths chosen to match the target sigma (Kovesi, "Fast almost-Gaussian
// filtering", 2010). Each pass is a running sum, so cost is independent of
// the radius. Samples outside the buffer read as `outside`.
export function boxSizesForGauss(sigma: number, n = 3): number[] {
  const ideal = Math.sqrt((12 * sigma * sigma) / n + 1);
  let wl = Math.floor(ideal);
  if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const m = Math.round((12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4));
  return Array.from({ length: n }, (_, i) => (i < m ? wl : wu));
}

function boxH(src: Float32Array, dst: Float32Array, w: number, h: number, r: number, outside: number) {
  const inv = 1 / (2 * r + 1);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let acc = outside * r;
    for (let x = 0; x < r; x++) acc += x < w ? src[row + x] : outside;
    for (let x = 0; x < w; x++) {
      const add = x + r, sub = x - r;
      acc += add < w ? src[row + add] : outside;
      dst[row + x] = acc * inv;
      acc -= sub >= 0 ? src[row + sub] : outside;
    }
  }
}
// Vertical pass with one accumulator per column so memory is read row by row.
function boxV(src: Float32Array, dst: Float32Array, w: number, h: number, r: number, outside: number, acc: Float64Array) {
  const inv = 1 / (2 * r + 1);
  acc.fill(outside * r);
  for (let y = 0; y < r; y++) {
    if (y < h) for (let x = 0, i = y * w; x < w; x++, i++) acc[x] += src[i];
    else for (let x = 0; x < w; x++) acc[x] += outside;
  }
  for (let y = 0; y < h; y++) {
    const add = y + r, sub = y - r;
    if (add < h) for (let x = 0, i = add * w; x < w; x++, i++) acc[x] += src[i];
    else for (let x = 0; x < w; x++) acc[x] += outside;
    for (let x = 0, i = y * w; x < w; x++, i++) dst[i] = acc[x] * inv;
    if (sub >= 0) for (let x = 0, i = sub * w; x < w; x++, i++) acc[x] -= src[i];
    else for (let x = 0; x < w; x++) acc[x] -= outside;
  }
}

// Blurs `buf` in place (scratch `tmp` of the same length is optional).
// Large sigmas run at reduced resolution: a box downsample by f, the blur
// with the variance left over, and a bilinear upsample. The two resampling
// steps add (f^2 - 1) / 4 of variance in total, which the reduced blur
// subtracts, so the overall width is unchanged; the result of a wide
// Gaussian is smooth enough that the difference is below 8-bit precision.
export function gaussianBlur(buf: Float32Array, w: number, h: number, sigma: number, outside = 0, tmp?: Float32Array): Float32Array {
  if (!(sigma > 0.2) || w === 0 || h === 0) return buf;
  const f = sigma >= 6 ? Math.min(4, Math.floor(sigma / 3)) : 1;
  if (f > 1) return blurReduced(buf, w, h, sigma, outside, f);
  const t = tmp ?? new Float32Array(buf.length);
  const acc = new Float64Array(w);
  for (const size of boxSizesForGauss(sigma)) {
    const r = (size - 1) >> 1;
    if (r < 1) continue;
    boxH(buf, t, w, h, r, outside);
    boxV(t, buf, w, h, r, outside, acc);
  }
  return buf;
}
function blurReduced(buf: Float32Array, w: number, h: number, sigma: number, outside: number, f: number) {
  // The low-res grid gets a one-sample border of `outside` so the upsample
  // needs no bounds checks.
  const lw = Math.ceil(w / f), lh = Math.ceil(h / f);
  const pw = lw + 2, ph = lh + 2;
  const low = new Float32Array(pw * ph).fill(outside);
  // Horizontal box reduce into `cols` (h x lw), then vertical into `low`.
  const cols = new Float32Array(h * lw);
  const inv = 1 / f;
  for (let y = 0; y < h; y++) {
    const row = y * w, out = y * lw;
    for (let lx = 0; lx < lw; lx++) {
      let s = 0;
      const x0 = lx * f;
      if (x0 + f <= w) for (let x = x0; x < x0 + f; x++) s += buf[row + x];
      else for (let x = x0; x < x0 + f; x++) s += x < w ? buf[row + x] : outside;
      cols[out + lx] = s * inv;
    }
  }
  for (let ly = 0; ly < lh; ly++) {
    const out = (ly + 1) * pw + 1;
    for (let lx = 0; lx < lw; lx++) low[out + lx] = 0;
    for (let dy = 0; dy < f; dy++) {
      const y = ly * f + dy;
      if (y < h) for (let lx = 0, i = y * lw; lx < lw; lx++, i++) low[out + lx] += cols[i];
      else for (let lx = 0; lx < lw; lx++) low[out + lx] += outside;
    }
    for (let lx = 0; lx < lw; lx++) low[out + lx] *= inv;
  }
  const rest = Math.sqrt(Math.max(0, sigma * sigma - (f * f - 1) / 4)) / f;
  gaussianBlur(low, pw, ph, rest, outside);
  // Bilinear upsample, separable: rows of the padded grid to full width,
  // then a vertical lerp. Low-res sample l sits at (l - 1 + 0.5) * f.
  const xi = new Int32Array(w), xf = new Float32Array(w);
  for (let x = 0; x < w; x++) {
    const u = (x + 0.5) / f - 0.5 + 1;
    const i0 = Math.min(pw - 2, Math.max(0, Math.floor(u)));
    xi[x] = i0;
    xf[x] = Math.min(1, Math.max(0, u - i0));
  }
  const wide = new Float32Array(ph * w);
  for (let ly = 0; ly < ph; ly++) {
    const src = ly * pw, dst = ly * w;
    for (let x = 0; x < w; x++) {
      const a = low[src + xi[x]];
      wide[dst + x] = a + (low[src + xi[x] + 1] - a) * xf[x];
    }
  }
  for (let y = 0; y < h; y++) {
    const v = (y + 0.5) / f - 0.5 + 1;
    const j0 = Math.min(ph - 2, Math.max(0, Math.floor(v)));
    const fy = Math.min(1, Math.max(0, v - j0));
    const r0 = j0 * w, r1 = r0 + w, out = y * w;
    for (let x = 0; x < w; x++) {
      const a = wide[r0 + x];
      buf[out + x] = a + (wide[r1 + x] - a) * fy;
    }
  }
  return buf;
}
// Sigma whose three-box approximation reaches about `extent` pixels before
// falling to zero; effect "size" parameters are extents.
export const sigmaForExtent = (extent: number) => extent / 3;
