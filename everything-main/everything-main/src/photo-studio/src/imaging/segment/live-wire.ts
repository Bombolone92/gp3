// Intelligent scissors for the Magnetic Lasso (Mortensen and Barrett, "Intelligent
// Scissors for Image Composition", SIGGRAPH 1995): minimum-cost paths over
// Laplacian zero-crossing, gradient magnitude and gradient direction costs.
// Link costs are static, so they are computed once per 64 px tile (lazily, as
// search windows reach them) and quantized to small integers; the search is then
// Dijkstra with a bucket queue (Dial's algorithm), expanded incrementally from
// the seed as the cursor moves, as in the paper.
import type { RGBA8 } from '../types';
import { gaussianBlurF32 } from './filters';

const DX = [1, 1, 0, -1, -1, -1, 0, 1], DY = [0, 1, 1, 1, 0, -1, -1, -1];
const WZ = 0.43, WG = 0.43, WD = 0.14, TILE = 64, SHIFT = 6, QUANT = 64, BUCKETS = 128;

// acos lookup over [-1, 1]: tile setup evaluates it 16 times per pixel.
const ACOS_N = 2048, ACOS = new Float32Array(ACOS_N + 1);
for (let i = 0; i <= ACOS_N; i++) ACOS[i] = Math.acos((2 * i) / ACOS_N - 1);

type Tile = { link: Uint8Array; grad: Float32Array };

export class LiveWire {
  readonly w: number;
  readonly h: number;
  private readonly win: number;
  private readonly gref: number;
  private readonly tiles = new Map<number, Tile>();
  private readonly tw: number;
  private sx = -1;
  private sy = -1;
  // Search window in image coordinates and its per-node state.
  private wx0 = 0;
  private wy0 = 0;
  private ww = 0;
  private wh = 0;
  private dist = new Int32Array(0);
  private from = new Int8Array(0);
  private state = new Uint8Array(0);
  private next = new Int32Array(0);
  private prev = new Int32Array(0);
  private readonly head = new Int32Array(BUCKETS);
  private cur = 0;
  private queued = 0;

  constructor(private readonly img: RGBA8, opts: { window?: number } = {}) {
    const { width: w, height: h, data } = img;
    this.w = w;
    this.h = h;
    this.win = opts.window ?? 320;
    this.tw = (w + TILE - 1) >> SHIFT;
    // Gradient normalization from a sparse sample (the paper divides by the
    // maximum; a high percentile is steadier and needs no full pass).
    const lum = (i: number) => ((0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]) * data[i * 4 + 3]) / 65025;
    const hist = new Uint32Array(1024);
    let count = 0;
    for (let y = 1; y < h - 1; y += 3)
      for (let x = 1; x < w - 1; x += 3) {
        const i = y * w + x, gx = lum(i + 1) - lum(i - 1), gy = lum(i + w) - lum(i - w);
        hist[Math.min(1023, Math.floor(Math.hypot(gx, gy) * 1023))]++;
        count++;
      }
    let k = 0;
    for (let acc = 0; k < 1023 && (acc += hist[k]) < count * 0.995; k++);
    // Central differences of a unit step read ~1/4 of the Sobel response.
    this.gref = Math.max(1e-3, ((k + 1) / 1023) * 4);
  }

  private tile(x: number, y: number): Tile {
    const key = (y >> SHIFT) * this.tw + (x >> SHIFT);
    let t = this.tiles.get(key);
    if (!t) {
      t = this.computeTile((x >> SHIFT) << SHIFT, (y >> SHIFT) << SHIFT);
      this.tiles.set(key, t);
    }
    return t;
  }

  private computeTile(X0: number, Y0: number): Tile {
    const { w, h, gref } = this, d = this.img.data, M = 4;
    const X1 = Math.min(w, X0 + TILE), Y1 = Math.min(h, Y0 + TILE);
    const bx0 = Math.max(0, X0 - M), by0 = Math.max(0, Y0 - M), bx1 = Math.min(w, X1 + M), by1 = Math.min(h, Y1 + M);
    const bw = bx1 - bx0, bh = by1 - by0, n = bw * bh, L = new Float32Array(n);
    for (let y = 0; y < bh; y++)
      for (let x = 0, i = ((y + by0) * w + bx0) * 4; x < bw; x++, i += 4)
        L[y * bw + x] = ((0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) * d[i + 3]) / 65025;
    gaussianBlurF32(L, bw, bh, 0.8);
    const G = new Float32Array(n), ux = new Float32Array(n), uy = new Float32Array(n), lap = new Float32Array(n), zc = new Float32Array(n);
    for (let y = 0; y < bh; y++)
      for (let x = 0; x < bw; x++) {
        const xm = x > 0 ? x - 1 : 0, xp = x < bw - 1 ? x + 1 : x, ym = y > 0 ? y - 1 : 0, yp = y < bh - 1 ? y + 1 : y, i = y * bw + x;
        const a = L[ym * bw + xm], b = L[ym * bw + x], c = L[ym * bw + xp], dd = L[y * bw + xm], f = L[y * bw + xp];
        const g = L[yp * bw + xm], hh = L[yp * bw + x], k = L[yp * bw + xp];
        const gx = c + 2 * f + k - a - 2 * dd - g, gy = g + 2 * hh + k - a - 2 * b - c, m = Math.hypot(gx, gy);
        G[i] = m;
        // Edge direction: perpendicular to the gradient.
        if (m > 0) {
          ux[i] = gy / m;
          uy[i] = -gx / m;
        }
        lap[i] = dd + f + b + hh - 4 * L[i];
      }
    const thr = gref * 0.02;
    for (let y = 0; y < bh; y++)
      for (let x = 0; x < bw; x++) {
        const i = y * bw + x, v = lap[i];
        // Laplacian zero crossing: the pixel of a sign-changing pair nearer zero.
        let z = 1;
        if (G[i] > thr && x > 0 && y > 0 && x < bw - 1 && y < bh - 1) {
          const av = Math.abs(v), p = lap[i - 1], q = lap[i + 1], r = lap[i - bw], s = lap[i + bw];
          if ((v * p < 0 && av <= Math.abs(p)) || (v * q < 0 && av <= Math.abs(q)) || (v * r < 0 && av <= Math.abs(r)) || (v * s < 0 && av <= Math.abs(s))) z = 0;
        }
        // Static part of every link into this pixel: zero crossing + gradient terms.
        zc[i] = WZ * z;
        G[i] = WG * (1 - Math.min(1, G[i] / gref));
      }
    const link = new Uint8Array(TILE * TILE * 8), grad = new Float32Array(TILE * TILE);
    for (let Y = Y0; Y < Y1; Y++)
      for (let X = X0; X < X1; X++) {
        const i = (Y - by0) * bw + (X - bx0), o = ((Y - Y0) << SHIFT) + (X - X0), upx = ux[i], upy = uy[i];
        grad[o] = 1 - G[i] / WG;
        for (let k = 0; k < 8; k++) {
          const qx = X + DX[k], qy = Y + DY[k];
          if (qx < 0 || qy < 0 || qx >= w || qy >= h) continue;
          const j = (qy - by0) * bw + (qx - bx0), diag = k & 1;
          // Direction term with the link oriented along the edge direction at p.
          let lx = DX[k], ly = DY[k];
          if (upx * lx + upy * ly < 0) {
            lx = -lx;
            ly = -ly;
          }
          const inv = diag ? Math.SQRT1_2 : 1;
          const dp = Math.min(1, Math.max(-1, (upx * lx + upy * ly) * inv)), dq = Math.min(1, Math.max(-1, (ux[j] * lx + uy[j] * ly) * inv));
          const fD = ACOS[Math.round((dp + 1) * (ACOS_N / 2))] + ACOS[Math.round((dq + 1) * (ACOS_N / 2))];
          const c = zc[j] + G[j] * (diag ? 1 : Math.SQRT1_2) + fD * ((2 * WD) / (3 * Math.PI));
          link[o * 8 + k] = Math.max(1, Math.min(BUCKETS - 1, Math.round(c * QUANT)));
        }
      }
    return { link, grad };
  }

  setSeed(x: number, y: number) {
    this.sx = Math.min(this.w - 1, Math.max(0, Math.round(x)));
    this.sy = Math.min(this.h - 1, Math.max(0, Math.round(y)));
    this.reset(this.sx - this.win, this.sy - this.win, this.sx + this.win, this.sy + this.win);
  }

  private reset(x0: number, y0: number, x1: number, y1: number) {
    this.wx0 = Math.max(0, x0);
    this.wy0 = Math.max(0, y0);
    this.ww = Math.min(this.w - 1, x1) - this.wx0 + 1;
    this.wh = Math.min(this.h - 1, y1) - this.wy0 + 1;
    const m = this.ww * this.wh;
    if (this.dist.length < m) {
      this.dist = new Int32Array(m);
      this.from = new Int8Array(m);
      this.state = new Uint8Array(m);
      this.next = new Int32Array(m);
      this.prev = new Int32Array(m);
    }
    this.state.fill(0, 0, m);
    this.head.fill(-1);
    this.cur = 0;
    this.queued = 0;
    const s = (this.sy - this.wy0) * this.ww + (this.sx - this.wx0);
    this.dist[s] = 0;
    this.from[s] = -1;
    this.state[s] = 1;
    this.insert(s, 0);
  }

  // Doubly linked bucket lists keyed by distance modulo BUCKETS (valid because
  // every link costs less than BUCKETS).
  private insert(p: number, d: number) {
    const b = d & (BUCKETS - 1), h = this.head[b];
    this.next[p] = h;
    this.prev[p] = -1;
    if (h >= 0) this.prev[h] = p;
    this.head[b] = p;
    this.queued++;
  }
  private remove(p: number, d: number) {
    const n = this.next[p], v = this.prev[p];
    if (v >= 0) this.next[v] = n;
    else this.head[d & (BUCKETS - 1)] = n;
    if (n >= 0) this.prev[n] = v;
    this.queued--;
  }

  // Minimum-cost path from the seed to (x, y) as integer pixel coordinates, seed
  // first. Incremental: nodes settled by earlier calls are reused.
  pathTo(x: number, y: number): [number, number][] {
    if (this.sx < 0) throw new Error('LiveWire: call setSeed first.');
    const tx = Math.min(this.w - 1, Math.max(0, Math.round(x))), ty = Math.min(this.h - 1, Math.max(0, Math.round(y)));
    if (tx < this.wx0 || ty < this.wy0 || tx >= this.wx0 + this.ww || ty >= this.wy0 + this.wh) {
      const m = 32;
      this.reset(Math.min(this.sx, tx) - m, Math.min(this.sy, ty) - m, Math.max(this.sx, tx) + m, Math.max(this.sy, ty) + m);
    }
    const { ww, wh, wx0, wy0, dist, from, state, head } = this;
    const target = (ty - wy0) * ww + (tx - wx0);
    let link: Uint8Array | null = null, tileKey = -1;
    while (state[target] !== 2 && this.queued) {
      while (head[this.cur & (BUCKETS - 1)] < 0) this.cur++;
      const dp = this.cur, p = head[dp & (BUCKETS - 1)];
      this.remove(p, dp);
      state[p] = 2;
      const px = p % ww, py = (p - px) / ww, gx = px + wx0, gy = py + wy0;
      const key = (gy >> SHIFT) * this.tw + (gx >> SHIFT);
      if (key !== tileKey) {
        tileKey = key;
        link = this.tile(gx, gy).link;
      }
      const lo = (((gy & (TILE - 1)) << SHIFT) + (gx & (TILE - 1))) * 8;
      for (let k = 0; k < 8; k++) {
        const qx = px + DX[k], qy = py + DY[k];
        if (qx < 0 || qy < 0 || qx >= ww || qy >= wh) continue;
        const q = qy * ww + qx, sq = state[q];
        if (sq === 2) continue;
        const c = dp + link![lo + k];
        if (sq === 0) {
          state[q] = 1;
          dist[q] = c;
          from[q] = k;
          this.insert(q, c);
        } else if (c < dist[q]) {
          this.remove(q, dist[q]);
          dist[q] = c;
          from[q] = k;
          this.insert(q, c);
        }
      }
    }
    if (state[target] !== 2) return [[this.sx, this.sy], [tx, ty]];
    const path: [number, number][] = [];
    for (let p = target; ; ) {
      const px = p % ww, py = (p - px) / ww;
      path.push([px + wx0, py + wy0]);
      const k = from[p];
      if (k < 0) break;
      p = (py - DY[k]) * ww + (px - DX[k]);
    }
    return path.reverse();
  }

  // Strongest edge pixel within `r` of (x, y), for snapping clicks to edges.
  snap(x: number, y: number, r = 5): [number, number] {
    const cx = Math.min(this.w - 1, Math.max(0, Math.round(x))), cy = Math.min(this.h - 1, Math.max(0, Math.round(y)));
    let bx = cx, by = cy, best = -1;
    for (let yy = Math.max(0, cy - r); yy <= Math.min(this.h - 1, cy + r); yy++)
      for (let xx = Math.max(0, cx - r); xx <= Math.min(this.w - 1, cx + r); xx++) {
        if ((xx - x) ** 2 + (yy - y) ** 2 > r * r) continue;
        const g = this.tile(xx, yy).grad[((yy & (TILE - 1)) << SHIFT) + (xx & (TILE - 1))];
        if (g > best) {
          best = g;
          bx = xx;
          by = yy;
        }
      }
    return [bx, by];
  }
}
