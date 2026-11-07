// Exact Euclidean distance transforms after Felzenszwalb & Huttenlocher,
// "Distance Transforms of Sampled Functions" (Theory of Computing, 2012):
// a 1D lower envelope of parabolas per column, then per row; O(n) overall.
const INF = 1e20;

// 1D squared-distance transform of f (length n) into d, with the index of
// the minimizing sample in arg. v/z are scratch.
function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array, arg: Int32Array) {
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1; q < n; q++) {
    const fq = f[q] + q * q;
    let s = (fq - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (fq - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const dq = q - v[k];
    d[q] = dq * dq + f[v[k]];
    arg[q] = v[k];
  }
}

// Squared distance from every pixel to the nearest seed pixel, and (in
// `site`) that seed's index. Pixels with no seed in the image get a huge
// value and site -1. Seeds are binary, so the column pass reduces to two
// integer sweeps (down, then up) run row by row for cache-friendly access;
// the parabola envelope is only needed along rows.
export function squaredDistance(
  w: number,
  h: number,
  seeds: Uint8Array | ((i: number) => boolean),
  out = new Float32Array(w * h),
  site?: Int32Array,
): Float32Array {
  const n = w * h;
  let mask: Uint8Array;
  if (typeof seeds === 'function') {
    mask = new Uint8Array(n);
    for (let i = 0; i < n; i++) mask[i] = seeds(i) ? 1 : 0;
  } else mask = seeds;
  const NONE = 0x3fffffff;
  const g = new Int32Array(n);
  const gr = site ? new Int32Array(n) : undefined;
  for (let x = 0; x < w; x++) {
    g[x] = mask[x] ? 0 : NONE;
    if (gr) gr[x] = mask[x] ? 0 : -1;
  }
  for (let y = 1; y < h; y++)
    for (let x = 0, i = y * w; x < w; x++, i++) {
      if (mask[i]) {
        g[i] = 0;
        if (gr) gr[i] = y;
      } else {
        const up = g[i - w];
        g[i] = up === NONE ? NONE : up + 1;
        if (gr) gr[i] = gr[i - w];
      }
    }
  for (let y = h - 2; y >= 0; y--)
    for (let x = 0, i = y * w; x < w; x++, i++) {
      const dn = g[i + w];
      if (dn !== NONE && dn + 1 < g[i]) {
        g[i] = dn + 1;
        if (gr) gr[i] = gr[i + w];
      }
    }
  const f = new Float64Array(w), d = new Float64Array(w), z = new Float64Array(w + 1);
  const v = new Int32Array(w), arg = new Int32Array(w);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let any = false;
    for (let x = 0; x < w; x++) {
      const gv = g[row + x];
      if (gv === NONE) f[x] = INF;
      else {
        f[x] = gv * gv;
        any = true;
      }
    }
    if (!any) {
      out.fill(INF, row, row + w);
      site?.fill(-1, row, row + w);
      continue;
    }
    edt1d(f, w, d, v, z, arg);
    for (let x = 0; x < w; x++) out[row + x] = d[x];
    if (site && gr)
      for (let x = 0; x < w; x++) {
        const sx = arg[x];
        site[row + x] = gr[row + sx] * w + sx;
      }
  }
  return out;
}

// Signed distance (pixels) from each pixel center to the shape edge:
// negative inside, positive outside. The shape is coverage >= 0.5. Exact
// Euclidean distances to the nearest pixel across the threshold are refined
// to sub-pixel accuracy from coverage: under a box-filter model the edge lies
// (a_s - 0.5) + a_n past the nearest inside pixel s, where n is the next pixel
// from s toward the query (and symmetrically from the inside). Binary shapes
// get exactly |p - s| - 0.5, and a band [0, r] covers clamp(r + 0.5 - sd) of
// a pixel, with box-filtered coverage on straight edges.
export function signedDistance(
  alpha: Float32Array,
  w: number,
  h: number,
  sides: { inside?: boolean; outside?: boolean } = { inside: true, outside: true },
): Float32Array {
  // A skipped side keeps only its local estimate next to the edge (0.5 - a)
  // and +-1e10 elsewhere; callers request the sides whose depth they read.
  const n = w * h;
  const seeds = new Uint8Array(n);
  for (let i = 0; i < n; i++) seeds[i] = alpha[i] >= 0.5 ? 1 : 0;
  const siteOut = sides.outside ? new Int32Array(n) : undefined;
  const dOut = sides.outside ? squaredDistance(w, h, seeds, new Float32Array(n), siteOut) : undefined;
  let siteIn: Int32Array | undefined, dIn: Float32Array | undefined;
  if (sides.inside) {
    for (let i = 0; i < n; i++) seeds[i] ^= 1;
    siteIn = new Int32Array(n);
    dIn = squaredDistance(w, h, seeds, new Float32Array(n), siteIn);
  }
  const sd = dOut ?? dIn ?? new Float32Array(n);
  for (let y = 0, i = 0; y < h; y++)
    for (let x = 0; x < w; x++, i++) {
      const a = alpha[i];
      const inside = a >= 0.5;
      const site = inside ? siteIn : siteOut;
      if (!site) {
        sd[i] = a > 0 && a < 1 ? 0.5 - a : inside ? -1e10 : 1e10;
        continue;
      }
      const s = site[i];
      const d2 = inside ? dIn![i] : dOut![i];
      if (s < 0) {
        sd[i] = inside ? -1e10 : 1e10;
        continue;
      }
      const sy = (s / w) | 0, sx = s - sy * w;
      const dx = x - sx, dy = y - sy;
      let nb = -1;
      if (Math.abs(dx) >= Math.abs(dy)) {
        const nx = sx + Math.sign(dx);
        if (nx >= 0 && nx < w) nb = s + Math.sign(dx);
      } else {
        const ny = sy + Math.sign(dy);
        if (ny >= 0 && ny < h) nb = s + Math.sign(dy) * w;
      }
      // Coverage on the far side of the edge, seen from the query pixel.
      const cs = inside ? 1 - alpha[s] : alpha[s];
      const cn = nb < 0 ? 0 : inside ? 1 - alpha[nb] : alpha[nb];
      const edge = Math.min(1, cs - 0.5 + (cn < 0.5 ? cn : 0));
      const dist = Math.sqrt(d2) - edge;
      sd[i] = inside ? -dist : dist;
    }
  return sd;
}
