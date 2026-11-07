// Canvas 2D renderer for the board (the full-length film). Everything visible is drawn with Canvas 2D:
// the board, frame, tray and wall are baked once in board space; the board's grain is baked into every chalk
// sprite (CFG.deposit) so chalk sits only on the slate's peaks; the eraser is a blurred destination-out band;
// the classroom light is a multiply gradient. WebGL2 only runs the post pass (post.js).
import { clamp, lerp } from '/core/lib.js';
import { CFG, rng, n1 } from './chalk.js';

// ───────── the slate's grain: one periodic tile, 256 board units square, 4 samples per unit
const TS = 1024, TU = 4;
function periodicNoise(cells, seed) {               // value noise that wraps every TS samples
  const R = rng(seed), g = new Float32Array(cells * cells); for (let i = 0; i < g.length; i++) g[i] = R();
  const out = new Float32Array(TS * TS), per = TS / cells;
  for (let y = 0; y < TS; y++) {
    const fy = y / per, iy = Math.floor(fy), ty = fy - iy, uy = ty * ty * (3 - 2 * ty), y0 = iy % cells, y1 = (iy + 1) % cells;
    for (let x = 0; x < TS; x++) {
      const fx = x / per, ix = Math.floor(fx), tx = fx - ix, ux = tx * tx * (3 - 2 * tx), x0 = ix % cells, x1 = (ix + 1) % cells;
      out[y * TS + x] = lerp(lerp(g[y0 * cells + x0], g[y0 * cells + x1], ux), lerp(g[y1 * cells + x0], g[y1 * cells + x1], ux), uy);
    }
  }
  return out;
}
export const GRAIN = (() => {
  const oct = [[512, .42], [280, .5], [120, .4], [50, .27], [20, .22]], T = new Float32Array(TS * TS).fill(.5);
  oct.forEach(([c, a], k) => { const n = periodicNoise(c, 91 + k * 17); for (let i = 0; i < T.length; i++) T[i] += (n[i] - .5) * a; });
  const R = rng(7); const cells = 280, per = TS / cells, hole = new Uint8Array(cells * cells); for (let i = 0; i < hole.length; i++) hole[i] = R() < .06;
  for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) if (hole[(Math.floor(y / per) % cells) * cells + Math.floor(x / per) % cells]) T[y * TS + x] -= .35;
  return T;
})();
export function grainAt(bx, by) {
  let x = (bx * TU) % TS, y = (by * TU) % TS; if (x < 0) x += TS; if (y < 0) y += TS;
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy, x1 = (ix + 1) % TS, y1 = (iy + 1) % TS;
  return lerp(lerp(GRAIN[iy * TS + ix], GRAIN[iy * TS + x1], fx), lerp(GRAIN[y1 * TS + ix], GRAIN[y1 * TS + x1], fx), fy);
}
// chalk deposit: coverage → what actually stays on the grains (2×2 supersampled), plus a faint powder halo
export function installDeposit() {
  const sst = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
  CFG.deposit = (cov, x0, y0, W, H, R) => {
    const N = W * H, out = new Float32Array(N);
    // halo: box-blurred coverage (radius ~3 units)
    const r = Math.max(1, Math.round(3 * R)), tmp = new Float32Array(N), hal = new Float32Array(N);
    for (let y = 0; y < H; y++) { let acc = 0; const o = y * W; for (let x = -r; x < W; x++) { if (x + r < W) acc += cov[o + x + r]; if (x - r - 1 >= 0) acc -= cov[o + x - r - 1]; if (x >= 0) tmp[o + x] = acc / (2 * r + 1); } }
    for (let x = 0; x < W; x++) { let acc = 0; for (let y = -r; y < H; y++) { if (y + r < H) acc += tmp[(y + r) * W + x]; if (y - r - 1 >= 0) acc -= tmp[(y - r - 1) * W + x]; if (y >= 0) hal[y * W + x] = acc / (2 * r + 1); } }
    for (let k = 0; k < N; k++) {
      const a = cov[k], h = hal[k];
      if (a <= .002 && h <= .002) continue;
      const px = k % W, py = (k - px) / W;
      let d = 0, gm = 0;
      if (a > .002) {
        const thr = .5 + (.55 - a) * 1.15;
        for (let j = 0; j < 4; j++) {
          const g = grainAt(x0 + (px + .25 + .5 * (j & 1)) / R, y0 + (py + .25 + .5 * (j >> 1)) / R); gm += g;
          d += sst(thr - .07, thr + .07, g);
        }
        d *= .25; gm *= .25;
      } else gm = grainAt(x0 + (px + .5) / R, y0 + (py + .5) / R);
      const al = d * (.62 + .36 * Math.min(1, a * 1.4)), hv = h * .05 * (.6 + .8 * gm);
      out[k] = al + (1 - al) * hv;
    }
    return out;
  };
}

// grain tile as a grey image, for the slate's micro texture (soft-light) in close shots
export function grainTile() {
  const cv = new OffscreenCanvas(TS, TS), x = cv.getContext('2d'), img = x.createImageData(TS, TS);
  for (let i = 0; i < TS * TS; i++) { const v = Math.round(clamp(GRAIN[i]) * 255); img.data[4 * i] = img.data[4 * i + 1] = img.data[4 * i + 2] = v; img.data[4 * i + 3] = 255; }
  x.putImageData(img, 0, 0); return cv;
}

