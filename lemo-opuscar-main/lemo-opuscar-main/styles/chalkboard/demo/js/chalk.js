// Chalk stroke engine: hand-drawn polylines → baked board-space coverage sprites.
// A sprite stores, per pixel, chalk coverage (0..1), the arc length where the stroke passes it (for
// progressive reveal in stroke order) and the lateral position across the chalk tip (for a round leading edge).
// The board's own grain (in the WebGL pass) then decides which grains actually catch the chalk.
import { clamp, lerp, hash, TAU } from '/core/lib.js';

// ───────── deterministic noise
export const h1 = (i, s = 0) => { const n = Math.sin(i * 127.1 + s * 311.7 + 74.7) * 43758.5453; return n - Math.floor(n); };
export const n1 = (x, s = 0) => { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return lerp(h1(i, s), h1(i + 1, s), u); };
const h2 = (x, y, s) => { const n = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453; return n - Math.floor(n); };
export const n2 = (x, y, s = 0) => {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy, ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  return lerp(lerp(h2(ix, iy, s), h2(ix + 1, iy, s), ux), lerp(h2(ix, iy + 1, s), h2(ix + 1, iy + 1, s), ux), uy);
};
export function rng(seed) { let a = (seed * 2654435761) >>> 0 || 1; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const sst = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };

// ───────── geometry
export function resample(p, step) {               // [[x,y],...] → evenly spaced
  const o = [p[0].slice()]; let carry = 0;
  for (let i = 1; i < p.length; i++) {
    const [ax, ay] = p[i - 1], [bx, by] = p[i], d = Math.hypot(bx - ax, by - ay);
    let s = step - carry;
    while (s <= d) { o.push([ax + (bx - ax) * s / d, ay + (by - ay) * s / d]); s += step; }
    carry = d - (s - step);
  }
  const L = p[p.length - 1], E = o[o.length - 1];
  if (Math.hypot(L[0] - E[0], L[1] - E[1]) > step * .2) o.push(L.slice());
  return o;
}
export function catmull(p, sub = 8) {              // centripetal-ish Catmull–Rom through points
  if (p.length < 3) return p.map(q => q.slice());
  const o = [];
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[Math.max(0, i - 1)], p1 = p[i], p2 = p[i + 1], p3 = p[Math.min(p.length - 1, i + 2)];
    for (let k = 0; k < sub; k++) {
      const t = k / sub, t2 = t * t, t3 = t2 * t;
      o.push([0, 1].map(j => .5 * (2 * p1[j] + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3)));
    }
  }
  o.push(p[p.length - 1].slice()); return o;
}
// smooth a polyline but keep sharp corners (turns sharper than `deg`) as corners
export function smoothKeepCorners(p, deg = 55, sub = 8) {
  if (p.length < 3) return p.map(q => q.slice());
  const parts = [[p[0]]];
  for (let i = 1; i < p.length - 1; i++) {
    const a = Math.atan2(p[i][1] - p[i - 1][1], p[i][0] - p[i - 1][0]), b = Math.atan2(p[i + 1][1] - p[i][1], p[i + 1][0] - p[i][0]);
    let d = Math.abs(b - a); if (d > Math.PI) d = TAU - d;
    parts[parts.length - 1].push(p[i]);
    if (d * 180 / Math.PI > deg) parts.push([p[i]]);
  }
  parts[parts.length - 1].push(p[p.length - 1]);
  const o = [];
  parts.forEach((q, k) => { const c = catmull(q, sub); (k ? c.slice(1) : c).forEach(x => o.push(x)); });
  return o;
}

// optional hook for a renderer that bakes the board's grain into the chalk (Canvas 2D pipeline): fn(cov, x0, y0, W, H, R) → cov'
export const CFG = { deposit: null };

// ───────── stroke
let SEED = 11;
export const COLORS = {
  white: [.95, .94, .90], kid: [.98, .90, .58], blue: [.45, .72, .99], orange: [1.0, .56, .26],
  red: [.98, .40, .36], amber: [1.0, .64, .32], yellow: [.99, .87, .45], green: [.55, .85, .52], violet: [.74, .60, .97], cyan: [.47, .86, .90],
};
export class Stroke {
  // pts [[x,y],...] board units. o: { w (half width, units), color, kind 'line'|'side'|'dot'|'write',
  //   press, wob (hand wobble amp), taper (0..1 how much the end thins), land (landing blob), seed, specks }
  constructor(pts, o = {}) {
    this.o = o; this.kind = o.kind || 'line'; this.w = o.w ?? 7; this.color = o.color || 'white';
    this.seed = o.seed ?? (SEED += 7.31); this.press = o.press ?? 1;
    const step = Math.max(.5, this.w * .12);
    let p = resample(pts, step);
    const wob = o.wob ?? 1.6, wav = o.wav ?? 160;
    if (wob > 0 && p.length > 3) {                 // hand wobble along the normal: slow drift + a finer tremor
      let s = 0; const q = [];
      for (let i = 0; i < p.length; i++) {
        const a = p[Math.max(0, i - 1)], b = p[Math.min(p.length - 1, i + 1)];
        const tx = b[0] - a[0], ty = b[1] - a[1], tl = Math.hypot(tx, ty) || 1;
        if (i) s += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
        const ramp = Math.min(1, s / 12);
        const off = wob * ramp * ((n1(s / wav, this.seed) - .5) * 2 + .35 * (n1(s / (wav * .18), this.seed + 3) - .5) * 2);
        q.push([p[i][0] - ty / tl * off, p[i][1] + tx / tl * off]);
      }
      p = q;
    }
    this.pts = p; const n = p.length; this.cum = new Float32Array(n);
    for (let i = 1; i < n; i++) this.cum[i] = this.cum[i - 1] + Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
    this.len = Math.max(.01, this.cum[n - 1]);
    this.t0 = 1e9; this.t1 = 1e9; this.sprite = null;
  }
  at(L) {
    const c = this.cum, p = this.pts; L = clamp(L, 0, this.len);
    let lo = 0, hi = c.length - 1; if (hi === 0) return p[0].slice();
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (c[m] < L) lo = m; else hi = m; }
    const u = (L - c[lo]) / ((c[hi] - c[lo]) || 1);
    return [lerp(p[lo][0], p[hi][0], u), lerp(p[lo][1], p[hi][1], u)];
  }
  dir(L) { const a = this.at(L - 2), b = this.at(L + 2); const d = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [(b[0] - a[0]) / d, (b[1] - a[1]) / d]; }
  get start() { return this.pts[0]; }
  get end() { return this.pts[this.pts.length - 1]; }
  // hand speed: slow landing, fast middle, slow lift.  u → fraction of length
  ease(u) { const k = this.o.ease ?? .8; return u - Math.sin(TAU * u) / TAU * k; }
  prog(t) { if (t <= this.t0) return 0; if (t >= this.t1) return 1; return this.ease((t - this.t0) / (this.t1 - this.t0)); }
  // speed (relative, ~0.2..1.8) at arc fraction f: invert ease numerically
  speedAt(f) {
    let lo = 0, hi = 1; for (let k = 0; k < 18; k++) { const m = (lo + hi) / 2; if (this.ease(m) < f) lo = m; else hi = m; }
    const u = (lo + hi) / 2, k = this.o.ease ?? .8; return 1 - k * Math.cos(TAU * u);
  }
  // half width at arc length s
  width(s) {
    const o = this.o, w = this.w, L = this.len, f = s / L;
    if (o.wfn) return w * o.wfn(s, L) * (.96 + .08 * n1(s / (w * 3.2), this.seed + 9));
    let m = 1;
    const land = o.land ?? 1;
    m *= 1 + .06 * land * (1 - sst(0, Math.min(L * .35, w * 2.4), s));           // chalk bites on landing
    const tp = o.taper ?? .25, tl = Math.min(L * (o.taperLen ?? .3), Math.max(w * 3, L * (o.taperLen ?? .3)));
    m *= 1 - tp * sst(L - tl, L, s);                                                  // lifting off
    if (o.endPress) m *= 1 + o.endPress * sst(L - w * 3, L - w * .6, s) * (1 - sst(L - w * .6, L, s) * .4);
    m *= .93 + .14 * n1(s / (w * 3.2), this.seed + 9);
    if (this.kind === 'write') m *= 1 + .06 * Math.sin(f * 3.1);
    return w * m;
  }
  pressure(s) {
    const o = this.o, L = this.len, w = this.w;
    let p = this.press * (o.pfn ? o.pfn(s, L) : 1);
    const v = this.speedAt(s / L);
    p *= lerp(1.12, .78, clamp((v - .2) / 1.6));                                       // fast = lighter
    p *= 1 + .14 * (o.land ?? 1) * (1 - sst(0, Math.min(L * .3, w * 2), s));
    const tp = o.taper ?? .25; p *= 1 - tp * .9 * sst(L - Math.max(w * 3, L * (o.taperLen ?? .3)), L, s);
    const skip = n1(s / (o.skipWav ?? 55), this.seed + 21);                          // chalk skipping over bumps
    p *= 1 - (o.skip ?? .35) * sst(.62, .95, skip);
    p *= .84 + .26 * n1(s / 13, this.seed + 33) + .08 * (n1(s / 3.5, this.seed + 34) - .5);
    return clamp(p, 0, 1.3);
  }
}

// ───────── baking
export function bake(st, R = 2) {
  if (st.o.outline) return bakeOutline(st, R);
  const o = st.o, pts = st.pts, side = st.kind === 'side';
  const wmax = st.w * 1.4 + 1, spr = o.specks ?? 1, mar = wmax + (spr ? Math.min(st.w * 3.2, 34) + 4 : 2);
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  x0 -= mar; y0 -= mar; x1 += mar; y1 += mar + (spr ? Math.min(st.w * 2, 20) : 0);
  const W = Math.max(2, Math.ceil((x1 - x0) * R)), H = Math.max(2, Math.ceil((y1 - y0) * R)), N = W * H;
  const D = new Float32Array(N).fill(1e9), S = new Float32Array(N).fill(-1), Lat = new Float32Array(N);
  const n = pts.length;
  // closest-point parametrisation, segment by segment
  for (let i = 0; i < Math.max(1, n - 1); i++) {
    const a = pts[i], b = pts[Math.min(n - 1, i + 1)];
    const ax = (a[0] - x0) * R, ay = (a[1] - y0) * R, bx = (b[0] - x0) * R, by = (b[1] - y0) * R;
    const dx = bx - ax, dy = by - ay, sl = Math.hypot(dx, dy) || 1e-6, tx = dx / sl, ty = dy / sl;
    const r = wmax * R;
    const px0 = Math.max(0, Math.floor(Math.min(ax, bx) - r)), px1 = Math.min(W - 1, Math.ceil(Math.max(ax, bx) + r));
    const py0 = Math.max(0, Math.floor(Math.min(ay, by) - r)), py1 = Math.min(H - 1, Math.ceil(Math.max(ay, by) + r));
    const cum = st.cum[i];
    for (let py = py0; py <= py1; py++) {
      const qy = py + .5 - ay;
      for (let px = px0; px <= px1; px++) {
        const qx = px + .5 - ax;
        let u = (qx * tx + qy * ty) / sl; u = u < 0 ? 0 : u > 1 ? 1 : u;
        const cx = qx - tx * u * sl, cy = qy - ty * u * sl, d = Math.hypot(cx, cy);
        const k = py * W + px;
        if (d < r && d < D[k]) { D[k] = d; S[k] = cum + u * sl / R; Lat[k] = (tx * cy - ty * cx) >= 0 ? d / R : -d / R; }
      }
    }
  }
  const cov = new Float32Array(N), sd = st.seed;
  const K = side ? st.w * .55 : Math.max(2.2, st.w * .5);          // streaks across the tip
  for (let k = 0; k < N; k++) {
    if (S[k] < 0) continue;
    const s = S[k], lat = Lat[k], w = st.width(s), nn = Math.abs(lat) / w;
    if (nn > 1.45) continue;
    // ends: no perfect round caps. Side strokes end flat; tip strokes end blunt and ragged
    const cap = s <= 1e-3 ? -1 : s >= st.len - 1e-3 ? 1 : 0;
    let capK = 1;
    if (cap) {
      if (side) { const dd = D[k] / R; if (dd > w * .35 * n1(lat / 9, sd + (cap > 0 ? 3 : 4))) continue; }
      else {
      const dd = D[k] / R, ang = Math.atan2(lat, dd);
      const lim = w * ((cap < 0 ? .72 : .55) + .3 * n1(ang * 2.2 + 3, sd + (cap > 0 ? 17 : 29)));
      if (dd > lim) continue;
      capK = .78 * (1 - dd / lim * .5);
      }
    }
    const sgn = lat >= 0 ? 1 : 0;
    const rg = o.clean ?? 1, e = 1 + (side ? .2 : .13 * rg) * (n1(s / (st.w * .55 + 1), sd + 50 + sgn * 13) - .5) * 2 + .07 * rg * (n1(s / 1.3, sd + 70 + sgn) - .5) * 2;
    const fp = sst(e, e - (side ? .26 : .14), nn);
    if (fp <= 0) continue;
    const l = lat / w;                                                // -1..1 across the tip
    // the tip is rounded: it presses hardest in the middle and only grazes the board at its edges
    const prof = Math.pow(Math.max(0, 1 - Math.min(1, nn) * Math.min(1, nn)), side ? .25 : .3);
    const drift = n1(s / (side ? 260 : 120), sd + 5) * 3;
    let str = n1((l + 1) * K + drift, sd + 101);
    str = side ? .55 + .6 * Math.pow(str, 1.2) : .8 + .3 * str;
    str *= side ? .82 + .3 * n2((l + 1) * K * 3, s / 16, sd + 7) : .9 + .16 * n2((l + 1) * K * 2.5, s / 3, sd + 7);
    let p = st.pressure(s);
    if (side) { p *= lerp(o.sideLo ?? .55, 1, (l + 1) / 2); p *= sst(-20 - 30 * n1(l * 3, sd), 70, s) * (1 - .8 * sst(st.len - 90 - 40 * n1(l * 2.5, sd + 1), st.len, s)); }
    cov[k] = clamp(fp * (.25 + .75 * prof) * str * p * capK * (side ? .78 : .8));
  }
  // loose powder: specks that fall off the chalk, a few more below the line and near the end
  if (spr) {
    const rr = rng(Math.floor(sd * 1000) + 3), cnt = o.endSpecks ? Math.floor(2 + rr() * 3 * spr) : Math.floor(st.len * (side ? .22 : .13) * spr + 3);
    for (let j = 0; j < cnt; j++) {
      const endBias = o.endSpecks || rr() < .25, s = endBias ? st.len * (1 - Math.pow(rr(), 2) * (o.endSpecks ? .12 : .25)) : rr() * st.len;
      const c = st.at(s), d = st.dir(s), w = st.width(s);
      const sideSign = rr() < .5 ? -1 : 1, off = Math.min(w * (1.0 + Math.pow(rr(), 2.2) * 1.6), w + 14) * sideSign;
      let x = c[0] - d[1] * off, y = c[1] + d[0] * off + Math.pow(rr(), 2.5) * Math.min(w * 1.6, 14);
      const rad = (.28 + rr() * .45) * (side ? 1.2 : 1), a = .5 + rr() * .4;
      const cx = (x - x0) * R, cy = (y - y0) * R, rp = rad * R + .7;
      for (let py = Math.max(0, Math.floor(cy - rp)); py <= Math.min(H - 1, Math.ceil(cy + rp)); py++)
        for (let px = Math.max(0, Math.floor(cx - rp)); px <= Math.min(W - 1, Math.ceil(cx + rp)); px++) {
          const dd = Math.hypot(px + .5 - cx, py + .5 - cy), v = a * clamp((rp - dd) / .9);
          if (v <= 0) continue;
          const k = py * W + px;
          if (v > cov[k]) { cov[k] = v; if (S[k] < 0 || S[k] > s) S[k] = s; }
        }
    }
  }
  return pack(st, cov, S, Lat, W, H, x0, y0, R);
}

// ───────── a Kai-script stroke: the font's own outline is the mask, the chalk fills it, the median reveals it
// o.outline = { path: Path2D in font units (y up), m: [a, b, c, d, e, f] font → board, box: [x0, y0, x1, y1] board }
function bakeOutline(st, R) {
  const o = st.o, ol = o.outline, sd = st.seed, sz = o.size;
  const mar = 10 + sz * .02;
  const x0 = ol.box[0] - mar, y0 = ol.box[1] - mar, x1 = ol.box[2] + mar, y1 = ol.box[3] + mar + sz * .01;
  const W = Math.max(2, Math.ceil((x1 - x0) * R)), H = Math.max(2, Math.ceil((y1 - y0) * R)), N = W * H;
  // 1. rasterise the outline
  const mc = new OffscreenCanvas(W, H), mx = mc.getContext('2d'), [a, b, c, d, e, f] = ol.m;
  mx.setTransform(R * a, R * b, R * c, R * d, R * (e - x0), R * (f - y0));
  mx.fillStyle = '#fff'; mx.fill(ol.path);
  const md = mx.getImageData(0, 0, W, H).data, A = new Float32Array(N);
  for (let k = 0; k < N; k++) A[k] = md[4 * k + 3] / 255;
  // 2. distance to the outside (chamfer), in board units, with the anti-aliased edge as sub-pixel offset
  const Dn = new Float32Array(N), BIG = 1e6;
  for (let k = 0; k < N; k++) Dn[k] = A[k] >= .5 ? BIG : 0;
  const D1 = 1, D2 = 1.4142;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const k = y * W + x; if (!Dn[k]) continue; let v = Dn[k];
    if (x > 0) v = Math.min(v, Dn[k - 1] + D1);
    if (y > 0) { v = Math.min(v, Dn[k - W] + D1); if (x > 0) v = Math.min(v, Dn[k - W - 1] + D2); if (x < W - 1) v = Math.min(v, Dn[k - W + 1] + D2); }
    Dn[k] = v;
  }
  for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
    const k = y * W + x; if (!Dn[k]) continue; let v = Dn[k];
    if (x < W - 1) v = Math.min(v, Dn[k + 1] + D1);
    if (y < H - 1) { v = Math.min(v, Dn[k + W] + D1); if (x < W - 1) v = Math.min(v, Dn[k + W + 1] + D2); if (x > 0) v = Math.min(v, Dn[k + W - 1] + D2); }
    Dn[k] = v;
  }
  // 3. where along the median each pixel lies (reveal order) and how far across
  const S = new Float32Array(N).fill(-1), Lat = new Float32Array(N), Dm = new Float32Array(N).fill(1e9);
  const P = st.pts.filter((q, i) => i % 3 === 0 || i === st.pts.length - 1), cum = [0];
  for (let i = 1; i < P.length; i++) cum.push(cum[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
  const scaleS = st.len / (cum[cum.length - 1] || 1), rr = sz * .16 * R;
  for (let i = 0; i < Math.max(1, P.length - 1); i++) {
    const p = P[i], q = P[Math.min(P.length - 1, i + 1)];
    const ax = (p[0] - x0) * R, ay = (p[1] - y0) * R, bx = (q[0] - x0) * R, by = (q[1] - y0) * R;
    const dx = bx - ax, dy = by - ay, sl = Math.hypot(dx, dy) || 1e-6, tx = dx / sl, ty = dy / sl;
    const qx0 = Math.max(0, Math.floor(Math.min(ax, bx) - rr)), qx1 = Math.min(W - 1, Math.ceil(Math.max(ax, bx) + rr));
    const qy0 = Math.max(0, Math.floor(Math.min(ay, by) - rr)), qy1 = Math.min(H - 1, Math.ceil(Math.max(ay, by) + rr));
    for (let py = qy0; py <= qy1; py++) for (let px = qx0; px <= qx1; px++) {
      const k = py * W + px; if (A[k] <= .01) continue;
      const ux = px + .5 - ax, uy = py + .5 - ay; let u = (ux * tx + uy * ty) / sl; u = u < 0 ? 0 : u > 1 ? 1 : u;
      const cx = ux - tx * u * sl, cy = uy - ty * u * sl, dd = Math.hypot(cx, cy);
      if (dd < Dm[k]) { Dm[k] = dd; S[k] = (cum[i] + u * sl / R) * scaleS; Lat[k] = ((tx * cy - ty * cx) >= 0 ? dd : -dd) / R; }
    }
  }
  // 4. chalk inside the outline: eroded, ragged edge; streaks along the stroke; pressure along it
  const cov = new Float32Array(N), er = o.erode ?? sz * .0032, soft = o.soft ?? sz * .006;
  for (let k = 0; k < N; k++) {
    if (A[k] <= .01 || S[k] < 0) continue;
    const s = S[k], lat = Lat[k], depth = Dn[k] / R + (A[k] - .5) / R;
    const sg = lat >= 0 ? 1 : 0;
    const rag = er * (.55 + .9 * n1(s / (sz * .012) + sg * 7.3, sd + 50)) + er * .5 * (n1(s / (sz * .003), sd + 60 + sg) - .5);
    const de = depth - rag;
    if (de <= -.4) continue;
    const edge = sst(-.4, soft, de);
    const drift = n1(s / (sz * .25), sd + 5) * 3;
    let str = .87 + .2 * n1(lat / (sz * .0068) + drift, sd + 101);
    str *= .93 + .12 * n2(lat / (sz * .0045), s / (sz * .007), sd + 7);
    const p = st.pressure(s);
    cov[k] = clamp(edge * str * p * .93);
  }
  // loose powder just outside the edge, a little more below
  const r2 = rng(Math.floor(sd * 997) + 5);
  for (let k = 0; k < N; k++) {
    if (A[k] <= .02 || A[k] >= .98) continue;           // the anti-aliased rim of the outline
    if (r2() > .05) continue;
    const ox = (r2() - .5) * sz * .02, oy = (r2() - .2) * sz * .03, x = (k % W) + ox * R, y = Math.floor(k / W) + oy * R;
    const rad = (.25 + r2() * .4) * R + .6, al = .45 + r2() * .4, sNear = S[k] < 0 ? 0 : S[k];
    for (let py = Math.max(0, Math.floor(y - rad)); py <= Math.min(H - 1, Math.ceil(y + rad)); py++)
      for (let px = Math.max(0, Math.floor(x - rad)); px <= Math.min(W - 1, Math.ceil(x + rad)); px++) {
        const q = py * W + px, v = al * clamp((rad - Math.hypot(px + .5 - x, py + .5 - y)) / .9);
        if (v > cov[q]) { cov[q] = v; if (S[q] < 0 || S[q] > sNear) S[q] = sNear; }
      }
  }
  return pack(st, cov, S, Lat, W, H, x0, y0, R);
}
function pack(st, cov, S, Lat, W, H, x0, y0, R) {
  if (CFG.deposit) cov = CFG.deposit(cov, x0, y0, W, H, R);
  const N = W * H, cv = new OffscreenCanvas(W, H), cx = cv.getContext('2d'), img = cx.createImageData(W, H), dd = img.data;
  const col = COLORS[st.color] || st.color, cr = Math.round(col[0] * 255), cg = Math.round(col[1] * 255), cb = Math.round(col[2] * 255);
  const A8 = new Uint8ClampedArray(N), LN = new Float32Array(N);
  for (let k = 0; k < N; k++) {
    const a = Math.round(cov[k] * 255); A8[k] = a;
    dd[4 * k] = cr; dd[4 * k + 1] = cg; dd[4 * k + 2] = cb; dd[4 * k + 3] = a;
    if (S[k] >= 0) LN[k] = clamp(Math.abs(Lat[k]) / st.width(S[k]), 0, 1.5);
  }
  cx.putImageData(img, 0, 0);
  st.sprite = { cv, W, H, x0, y0, R, A8, S, LN, rgb: [cr, cg, cb], img: null, part: null, lastCut: -1 };
  return st;
}

// partial sprite for a stroke in progress: everything up to arc length sNow, with a round leading edge
export function partial(st, sNow) {
  const sp = st.sprite;
  if (!sp.part) { sp.part = new OffscreenCanvas(sp.W, sp.H); sp.pctx = sp.part.getContext('2d'); sp.img = sp.pctx.createImageData(sp.W, sp.H); }
  if (Math.abs(sp.lastCut - sNow) < 1e-4) return sp.part;
  const d = sp.img.data, A = sp.A8, S = sp.S, LN = sp.LN, [r, g, b] = sp.rgb, w = st.width(sNow);
  const soft = Math.max(.6, w * .18);
  for (let k = 0, N = sp.W * sp.H; k < N; k++) {
    const s = S[k]; let a = 0;
    if (s >= 0 && A[k]) {
      const l = Math.min(1, LN[k]), cut = sNow - w * (1 - Math.sqrt(1 - l * l));
      if (s <= cut) a = A[k]; else if (s < cut + soft) a = A[k] * (1 - (s - cut) / soft);
      if (s > sNow - w * 1.6 && s <= cut + soft) a = Math.min(255, a * 1.12);      // fresh chalk right at the tip
    }
    const q = 4 * k; d[q] = r; d[q + 1] = g; d[q + 2] = b; d[q + 3] = a;
  }
  sp.pctx.putImageData(sp.img, 0, 0); sp.lastCut = sNow;
  return sp.part;
}

// draw a stroke (complete or partial) into a 2D context already transformed board → screen
export function drawStroke(ctx, st, t) {
  const f = st.prog(t); if (f <= 0) return;
  const sp = st.sprite, img = f >= 1 ? sp.cv : partial(st, f * st.len);
  ctx.drawImage(img, sp.x0, sp.y0, sp.W / sp.R, sp.H / sp.R);
}

// ───────── shape builders
export const line = (x0, y0, x1, y1, o = {}) => {
  const L = Math.hypot(x1 - x0, y1 - y0) || 1, nx = -(y1 - y0) / L, ny = (x1 - x0) / L, bow = (o.bow ?? .012) * L * ((hash(SEED) - .5) * 2);
  const mid = [(x0 + x1) / 2 + nx * bow, (y0 + y1) / 2 + ny * bow];
  return new Stroke(catmull([[x0, y0], mid, [x1, y1]], 12), o);
};
export const curve = (p, o = {}) => new Stroke(catmull(p, 10), o);
export const poly = (p, o = {}) => new Stroke(p, o);
export function arc(cx, cy, r, a0, a1, o = {}) {
  const n = Math.max(12, Math.ceil(Math.abs(a1 - a0) * r / 6)), p = [], ry = o.ry ?? r, wob = o.rwob ?? .025;
  for (let i = 0; i <= n; i++) { const a = lerp(a0, a1, i / n), rr = r * (1 + wob * (n1(i / n * 3, (o.seed ?? 3) + 40) - .5) * 2); p.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * ry / r]); }
  return new Stroke(p, { wav: 260, ...o });
}
export function zigzag(x0, y0, x1, y1, amp, wl, o = {}) {
  const L = Math.hypot(x1 - x0, y1 - y0), tx = (x1 - x0) / L, ty = (y1 - y0) / L, nx = -ty, ny = tx, k = Math.max(2, Math.round(L / wl * 2));
  const p = [[x0, y0]];
  for (let i = 1; i < k; i++) { const s = i / k * L, a = (i % 2 ? 1 : -1) * amp * (.85 + .3 * hash(i * 3.7 + SEED)); p.push([x0 + tx * s + nx * a, y0 + ty * s + ny * a]); }
  p.push([x1, y1]);
  return new Stroke(smoothKeepCorners(p, 170, 3), { wob: .6, ...o });
}
// arrow head as one short stroke: barb → tip → barb
export function head(x, y, ang, size, o = {}) {
  const a1 = ang + Math.PI - .5, a2 = ang + Math.PI + .5;
  return new Stroke([[x + Math.cos(a1) * size, y + Math.sin(a1) * size], [x, y], [x + Math.cos(a2) * size, y + Math.sin(a2) * size]], { wob: .3, taper: .3, ...o });
}

// ───────── Chinese characters from stroke-order medians (makemeahanzi / hanzi-writer-data)
// returns Stroke[] in writing order. data.medians: [[[x,y],...],...] in a 1024 box, y up, baseline 900.
export function glyph(data, cx, cy, size, o = {}) {
  const rot = (o.rot ?? 0) * Math.PI / 180, sc = size / 1024, out = [];
  const seed = o.seed ?? 5, R = rng(seed * 977);
  const mlen = data.medians.map(m => m.slice(1).reduce((a, q, i) => a + Math.hypot(q[0] - m[i][0], q[1] - m[i][1]), 0));
  const mainIdx = mlen.indexOf(Math.max(...mlen));
  data.medians.forEach((m, si) => {
    // one affine map per stroke, font units (y up) → board: scale, a touch of hand jitter, the character's tilt
    const jr = (R() - .5) * (o.jit ?? .012), jx = (R() - .5) * size * (o.jitp ?? .004), jy = (R() - .5) * size * (o.jitp ?? .004);
    const raw = m.map(([x, y]) => [(x - 512) * sc, (900 - y - 512) * sc]);
    const mx = raw.reduce((a, q) => a + q[0], 0) / raw.length, my = raw.reduce((a, q) => a + q[1], 0) / raw.length;
    // a personal hand (optional): horizontals rise a little to the right; the main (longest) stroke is drawn out
    const ex = raw[raw.length - 1][0] - raw[0][0], ey = raw[raw.length - 1][1] - raw[0][1], el = Math.hypot(ex, ey) || 1;
    const dev = Math.max(...raw.map(([qx, qy]) => Math.abs((qx - raw[0][0]) * ey - (qy - raw[0][1]) * ex) / el));
    const horiz = Math.abs(ex) > el * .9 && dev < el * .12, isMain = o.hand && si === mainIdx;
    const rotS = jr - (o.hand && horiz ? (o.slant ?? 2.4) * Math.PI / 180 : 0), ux = ex / el, uy = ey / el, kk = isMain ? (o.mainLen ?? 1.07) - 1 : 0;
    const F = (x, y) => {
      let X = (x - 512) * sc, Y = (900 - y - 512) * sc; let dx = X - mx, dy = Y - my;
      if (kk) { const pr = dx * ux + dy * uy; dx += kk * pr * ux; dy += kk * pr * uy; }
      X = mx + dx * Math.cos(rotS) - dy * Math.sin(rotS) + jx; Y = my + dx * Math.sin(rotS) + dy * Math.cos(rotS) + jy;
      return [cx + X * Math.cos(rot) - Y * Math.sin(rot), cy + X * Math.sin(rot) + Y * Math.cos(rot)];
    };
    const O = F(0, 0), Ux = F(1, 0), Uy = F(0, 1), M = [Ux[0] - O[0], Ux[1] - O[1], Uy[0] - O[0], Uy[1] - O[1], O[0], O[1]];
    let p = m.map(([x, y]) => F(x, y));
    const L = p.slice(1).reduce((a, q, i) => a + Math.hypot(q[0] - p[i][0], q[1] - p[i][1]), 0);
    const a = p[p.length - 2] || p[0], b = p[p.length - 1], dl = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, dx = (b[0] - a[0]) / dl, dy = (b[1] - a[1]) / dl;
    let taper = .2, taperLen = .3;
    const pie = dy > .35 && dx < -.3, hook = p.length >= 3 && dl < L * .2 && dy < -.2;
    if (pie) { taper = .45; taperLen = .35; } else if (hook) { taper = .4; taperLen = .15; }
    if (o.outline !== false) {
      const nums = data.strokes[si].match(/-?\d+(\.\d+)?/g).map(Number), bx = [1e9, 1e9, -1e9, -1e9];
      for (let i = 0; i + 1 < nums.length; i += 2) { const q = F(nums[i], nums[i + 1]); bx[0] = Math.min(bx[0], q[0]); bx[1] = Math.min(bx[1], q[1]); bx[2] = Math.max(bx[2], q[0]); bx[3] = Math.max(bx[3], q[1]); }
      const pts = smoothKeepCorners(p, 48, 6);
      out.push(new Stroke(pts, { kind: 'write', w: size * .022, color: o.color || 'white', taper, taperLen, wob: 0, land: 1.0, skip: .22, press: o.press ?? 1.08, size,
        outline: { path: new Path2D(data.strokes[si]), m: M, box: bx }, erode: o.erode, soft: o.soft, ...o.extra, seed: seed * 31 + si * 7.7 }));
      return;
    }
    // (centre-line version, kept for the ghosts of the old lesson)
    const ext = (u, v, e) => { const d = Math.hypot(u[0] - v[0], u[1] - v[1]) || 1; return [u[0] + (u[0] - v[0]) / d * e, u[1] + (u[1] - v[1]) / d * e]; };
    if (p.length >= 2) { p[0] = ext(p[0], p[1], size * .016); p[p.length - 1] = ext(p[p.length - 1], p[p.length - 2], size * .012); }
    out.push(new Stroke(smoothKeepCorners(p, 48, 6), { kind: 'write', w: o.w ?? size * .0155, color: o.color || 'white', taper, taperLen, wob: o.wob ?? size * .004, wav: size * .5, land: 1.1, skip: .25, press: o.press ?? 1.05, specks: .8, ...o.extra, seed: seed * 31 + si * 7.7 }));
  });
  return out;
}
