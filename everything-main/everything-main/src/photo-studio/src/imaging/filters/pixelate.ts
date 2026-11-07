// Pixelate filters. Cell grids are anchored to the image origin and all
// randomness is a stateless hash of cell coordinates, so a selection or a
// preview crop renders exactly the same cells as the full image.
import type { ImageOperation, IRect, OperationContext, ParamValues, RGBA8 } from '../types';
import { checkCancelled, cloneRGBA8 } from '../types';
import { blendSelection, hash3, num, sampleBilinear, selectionBounds, str } from './sampling';

function seedOf(p: ParamValues, ctx: OperationContext) {
  return (Math.round(num(p, 'seed', 0)) ^ Math.imul((ctx.seed ?? 0) | 0, 0x9e3779b1)) >>> 0;
}
const seedParam = { key: 'seed', label: 'Seed', type: 'number' as const, min: 0, max: 99999, step: 1, default: 1 };
// Runs `body` over the selection bounds of a copy, then blends by coverage.
function within(src: RGBA8, ctx: OperationContext, body: (out: RGBA8, b: IRect) => void): RGBA8 {
  const b = selectionBounds(src, ctx.selection);
  const out = cloneRGBA8(src);
  if (!b) return out;
  body(out, b);
  return blendSelection(src, out, ctx.selection);
}

export const mosaic: ImageOperation = {
  id: 'mosaic',
  label: 'Mosaic',
  category: 'Pixelate',
  params: [{ key: 'cellSize', label: 'Cell size', type: 'number', min: 2, max: 200, step: 1, default: 8, unit: 'px' }],
  apply(src, p, ctx, progress) {
    const c = Math.max(1, num(p, 'cellSize', 8) * (ctx.scale ?? 1));
    return within(src, ctx, (out, b) => {
      const { width: w, height: h, data: s } = src,
        d = out.data;
      const cx0 = Math.floor(b.x / c),
        cx1 = Math.floor((b.x + b.width - 1) / c),
        cy0 = Math.floor(b.y / c),
        cy1 = Math.floor((b.y + b.height - 1) / c);
      for (let cy = cy0; cy <= cy1; cy++) {
        checkCancelled(progress);
        const y0 = Math.max(0, Math.round(cy * c)),
          y1 = Math.min(h, Math.round((cy + 1) * c));
        for (let cx = cx0; cx <= cx1; cx++) {
          const x0 = Math.max(0, Math.round(cx * c)),
            x1 = Math.min(w, Math.round((cx + 1) * c));
          let r = 0,
            g = 0,
            bl = 0,
            a = 0;
          for (let y = y0; y < y1; y++)
            for (let x = x0, k = (y * w + x0) * 4; x < x1; x++, k += 4) {
              const al = s[k + 3];
              r += s[k] * al;
              g += s[k + 1] * al;
              bl += s[k + 2] * al;
              a += al;
            }
          const n = (x1 - x0) * (y1 - y0);
          const R = a ? r / a : 0,
            G = a ? g / a : 0,
            B = a ? bl / a : 0,
            A = n ? a / n : 0;
          for (let y = y0; y < y1; y++)
            for (let x = x0, k = (y * w + x0) * 4; x < x1; x++, k += 4) {
              d[k] = R;
              d[k + 1] = G;
              d[k + 2] = B;
              d[k + 3] = A;
            }
        }
      }
    });
  },
};

// Jittered feature point of grid cell (i, j), in pixels.
function cellPoint(i: number, j: number, c: number, seed: number, out: Float64Array) {
  out[0] = (i + 0.1 + 0.8 * hash3(i, j, seed)) * c;
  out[1] = (j + 0.1 + 0.8 * hash3(i, j, seed ^ 0x68e31da4)) * c;
}

export const crystallize: ImageOperation = {
  id: 'crystallize',
  label: 'Crystallize',
  category: 'Pixelate',
  params: [
    { key: 'cellSize', label: 'Cell size', type: 'number', min: 3, max: 300, step: 1, default: 10, unit: 'px' },
    seedParam,
  ],
  apply(src, p, ctx, progress) {
    const c = Math.max(2, num(p, 'cellSize', 10) * (ctx.scale ?? 1)),
      seed = seedOf(p, ctx);
    return within(src, ctx, (out, b) => {
      const { width: w, data: s } = src,
        d = out.data;
      // Voronoi labels (Worley 1996): nearest jittered point among the 3x3 cells.
      const gi0 = Math.floor(b.x / c) - 1,
        gj0 = Math.floor(b.y / c) - 1;
      const gw = Math.floor((b.x + b.width) / c) - gi0 + 2,
        gh = Math.floor((b.y + b.height) / c) - gj0 + 2;
      const px = new Float64Array(gw * gh),
        py = new Float64Array(gw * gh),
        t = new Float64Array(2);
      for (let j = 0; j < gh; j++)
        for (let i = 0; i < gw; i++) {
          cellPoint(gi0 + i, gj0 + j, c, seed, t);
          px[j * gw + i] = t[0];
          py[j * gw + i] = t[1];
        }
      const label = new Int32Array(b.width * b.height);
      const sums = new Float64Array(gw * gh * 4);
      for (let y = 0; y < b.height; y++) {
        if ((y & 63) === 0) checkCancelled(progress);
        const Y = b.y + y + 0.5,
          cj = Math.floor(Y / c) - gj0;
        for (let x = 0; x < b.width; x++) {
          const X = b.x + x + 0.5,
            ci = Math.floor(X / c) - gi0;
          let best = Infinity,
            bi = 0;
          for (let dj = -1; dj <= 1; dj++)
            for (let di = -1; di <= 1; di++) {
              const k = (cj + dj) * gw + ci + di,
                ex = px[k] - X,
                ey = py[k] - Y,
                dd = ex * ex + ey * ey;
              if (dd < best) ((best = dd), (bi = k));
            }
          label[y * b.width + x] = bi;
          const q = ((b.y + y) * w + b.x + x) * 4,
            a = s[q + 3];
          sums[bi * 4] += s[q] * a;
          sums[bi * 4 + 1] += s[q + 1] * a;
          sums[bi * 4 + 2] += s[q + 2] * a;
          sums[bi * 4 + 3] += a;
        }
      }
      const counts = new Float64Array(gw * gh);
      for (let i = 0; i < label.length; i++) counts[label[i]]++;
      for (let y = 0; y < b.height; y++)
        for (let x = 0; x < b.width; x++) {
          const l = label[y * b.width + x],
            q = ((b.y + y) * w + b.x + x) * 4,
            a = sums[l * 4 + 3];
          d[q] = a ? sums[l * 4] / a : 0;
          d[q + 1] = a ? sums[l * 4 + 1] / a : 0;
          d[q + 2] = a ? sums[l * 4 + 2] / a : 0;
          d[q + 3] = a / counts[l];
        }
    });
  },
};

export const pointillize: ImageOperation = {
  id: 'pointillize',
  label: 'Pointillize',
  category: 'Pixelate',
  params: [
    { key: 'cellSize', label: 'Cell size', type: 'number', min: 3, max: 300, step: 1, default: 5, unit: 'px' },
    seedParam,
  ],
  apply(src, p, ctx, progress) {
    const c = Math.max(2, num(p, 'cellSize', 5) * (ctx.scale ?? 1)),
      seed = seedOf(p, ctx);
    const [br, bg, bb] = ctx.background;
    return within(src, ctx, (out, b) => {
      const { width: w } = src,
        d = out.data;
      const gi0 = Math.floor(b.x / c) - 2,
        gj0 = Math.floor(b.y / c) - 2;
      const gw = Math.floor((b.x + b.width) / c) - gi0 + 3,
        gh = Math.floor((b.y + b.height) / c) - gj0 + 3;
      // Per dot: center, radius and the source color under the center.
      const P = new Float32Array(gw * gh * 7),
        t = new Float64Array(2),
        col = new Float32Array(4);
      for (let j = 0; j < gh; j++)
        for (let i = 0; i < gw; i++) {
          const k = (j * gw + i) * 7;
          cellPoint(gi0 + i, gj0 + j, c, seed, t);
          sampleBilinear(src, t[0], t[1], 'clamp', col, 0);
          P[k] = t[0];
          P[k + 1] = t[1];
          P[k + 2] = c * (0.5 + 0.25 * hash3(gi0 + i, gj0 + j, seed ^ 0x1b873593));
          P[k + 3] = col[0];
          P[k + 4] = col[1];
          P[k + 5] = col[2];
          P[k + 6] = col[3];
        }
      for (let y = 0; y < b.height; y++) {
        if ((y & 63) === 0) checkCancelled(progress);
        const Y = b.y + y + 0.5,
          cj = Math.floor(Y / c) - gj0;
        for (let x = 0; x < b.width; x++) {
          const X = b.x + x + 0.5,
            ci = Math.floor(X / c) - gi0;
          // The dot whose edge is deepest under this pixel wins.
          let best = -Infinity,
            bk = -1;
          for (let dj = -1; dj <= 1; dj++)
            for (let di = -1; di <= 1; di++) {
              const k = ((cj + dj) * gw + ci + di) * 7,
                ex = P[k] - X,
                ey = P[k + 1] - Y,
                depth = P[k + 2] - Math.sqrt(ex * ex + ey * ey);
              if (depth > best) ((best = depth), (bk = k));
            }
          const cov = Math.max(0, Math.min(1, best + 0.5)) * (P[bk + 6] / 255),
            q = ((b.y + y) * w + b.x + x) * 4;
          d[q] = br + (P[bk + 3] - br) * cov;
          d[q + 1] = bg + (P[bk + 4] - bg) * cov;
          d[q + 2] = bb + (P[bk + 5] - bb) * cov;
          d[q + 3] = 255;
        }
      }
    });
  },
};

export const colorHalftone: ImageOperation = {
  id: 'color-halftone',
  label: 'Color Halftone',
  category: 'Pixelate',
  params: [
    { key: 'maxRadius', label: 'Max. radius', type: 'number', min: 4, max: 127, step: 1, default: 8, unit: 'px' },
    { key: 'angle1', label: 'Channel 1 angle', type: 'number', min: -360, max: 360, default: 108, unit: '°' },
    { key: 'angle2', label: 'Channel 2 angle', type: 'number', min: -360, max: 360, default: 162, unit: '°' },
    { key: 'angle3', label: 'Channel 3 angle', type: 'number', min: -360, max: 360, default: 90, unit: '°' },
  ],
  apply(src, p, ctx, progress) {
    const R = Math.max(1, num(p, 'maxRadius', 8) * (ctx.scale ?? 1)),
      cs = R * Math.SQRT2;
    const angles = [num(p, 'angle1', 108), num(p, 'angle2', 162), num(p, 'angle3', 90)].map((a) => (a * Math.PI) / 180);
    return within(src, ctx, (out, b) => {
      const { width: w } = src,
        d = out.data,
        col = new Float32Array(4);
      for (let ch = 0; ch < 3; ch++) {
        const cs_ = Math.cos(angles[ch]),
          sn = Math.sin(angles[ch]);
        // Dot radius per screen cell, tabulated over the cells that cover the box.
        let u0 = Infinity,
          u1 = -Infinity,
          v0 = Infinity,
          v1 = -Infinity;
        for (const [X, Y] of [
          [b.x, b.y],
          [b.x + b.width, b.y],
          [b.x, b.y + b.height],
          [b.x + b.width, b.y + b.height],
        ]) {
          const u = (X * cs_ + Y * sn) / cs,
            v = (-X * sn + Y * cs_) / cs;
          ((u0 = Math.min(u0, u)), (u1 = Math.max(u1, u)), (v0 = Math.min(v0, v)), (v1 = Math.max(v1, v)));
        }
        const iu0 = Math.floor(u0) - 2,
          iv0 = Math.floor(v0) - 2,
          nu = Math.floor(u1) - iu0 + 3,
          nv = Math.floor(v1) - iv0 + 3;
        const rad = new Float32Array(nu * nv);
        for (let j = 0; j < nv; j++)
          for (let i = 0; i < nu; i++) {
            const cu = iu0 + i + 0.5,
              cv = iv0 + j + 0.5;
            sampleBilinear(src, (cu * cs_ - cv * sn) * cs, (cu * sn + cv * cs_) * cs, 'clamp', col, 0);
            // Dot area tracks the value (radius cs * sqrt(v / pi)) up to half
            // coverage; beyond that the radius grows linearly to the cell's
            // circumradius plus the antialiasing margin so solid areas stay solid.
            const v = col[ch] / 255,
              half = cs * Math.sqrt(0.5 / Math.PI);
            rad[j * nu + i] = v <= 0.5 ? cs * Math.sqrt(v / Math.PI) : half + (R + 0.5 - half) * (2 * v - 1);
          }
        for (let y = 0; y < b.height; y++) {
          if ((y & 63) === 0) checkCancelled(progress);
          const Y = b.y + y + 0.5;
          for (let x = 0; x < b.width; x++) {
            const X = b.x + x + 0.5;
            // Screen coordinates rotated by the channel's angle.
            const u = (X * cs_ + Y * sn) / cs,
              v = (-X * sn + Y * cs_) / cs;
            const iu = Math.floor(u),
              iv = Math.floor(v);
            let cov = 0;
            // A dot can spill into the neighbouring cells once it outgrows its own.
            for (let dv = -1; dv <= 1 && cov < 1; dv++)
              for (let du = -1; du <= 1 && cov < 1; du++) {
                const eu = (u - (iu + du + 0.5)) * cs,
                  ev = (v - (iv + dv + 0.5)) * cs;
                const rd = rad[(iv + dv - iv0) * nu + iu + du - iu0];
                // Dots smaller than a pixel fade out instead of leaving a half-lit pixel.
                const c = (rd - Math.sqrt(eu * eu + ev * ev) + 0.5) * (rd < 1 ? rd : 1);
                if (c > cov) cov = c > 1 ? 1 : c;
              }
            d[((b.y + y) * w + b.x + x) * 4 + ch] = cov * 255;
          }
        }
      }
    });
  },
};

export const fragment: ImageOperation = {
  id: 'fragment',
  label: 'Fragment',
  category: 'Pixelate',
  immediate: true,
  params: [],
  apply(src, _p, ctx, progress) {
    // Four copies offset diagonally by 4 px, averaged with alpha weights.
    const o = Math.max(1, Math.round(4 * (ctx.scale ?? 1)));
    return within(src, ctx, (out, b) => {
      const { width: w, height: h, data: s } = src,
        d = out.data;
      for (let y = b.y; y < b.y + b.height; y++) {
        if ((y & 63) === 0) checkCancelled(progress);
        const ya = Math.max(0, y - o) * w,
          yb = Math.min(h - 1, y + o) * w;
        for (let x = b.x; x < b.x + b.width; x++) {
          const xa = Math.max(0, x - o),
            xb = Math.min(w - 1, x + o);
          let r = 0,
            g = 0,
            bl = 0,
            a = 0;
          for (let t = 0; t < 4; t++) {
            const k = ((t < 2 ? ya : yb) + (t & 1 ? xb : xa)) * 4,
              al = s[k + 3];
            r += s[k] * al;
            g += s[k + 1] * al;
            bl += s[k + 2] * al;
            a += al;
          }
          const q = (y * w + x) * 4;
          d[q] = a ? r / a : 0;
          d[q + 1] = a ? g / a : 0;
          d[q + 2] = a ? bl / a : 0;
          d[q + 3] = a / 4;
        }
      }
    });
  },
};

export const facet: ImageOperation = {
  id: 'facet',
  label: 'Facet',
  category: 'Pixelate',
  immediate: true,
  params: [],
  apply(src, _p, ctx, progress) {
    // Kuwahara filter (Kuwahara et al. 1976): each pixel takes the mean of the
    // lowest-variance of its four overlapping quadrants, which flattens similar
    // colors into facets while keeping edges sharp. Window sums are running
    // sums over a ring of rows, so memory stays O(width).
    const r = Math.max(1, Math.round(2 * (ctx.scale ?? 1))),
      s = r + 1;
    return within(src, ctx, (out, b) => {
      const { width: w, height: h, data: sd } = src,
        d = out.data;
      const PL = 6,
        bw = b.width + 2 * r,
        x0 = b.x - r;
      const V = new Float64Array(bw * PL),
        ring = new Float64Array((r + 1) * bw * PL);
      const addRow = (yy: number, sign: number) => {
        const row = Math.min(h - 1, Math.max(0, yy)) * w;
        for (let i = 0; i < bw; i++) {
          const x = Math.min(w - 1, Math.max(0, x0 + i)),
            k = (row + x) * 4,
            a = sd[k + 3] / 255,
            l = (0.299 * sd[k] + 0.587 * sd[k + 1] + 0.114 * sd[k + 2]) * a,
            v = i * PL;
          V[v] += sign * sd[k] * a;
          V[v + 1] += sign * sd[k + 1] * a;
          V[v + 2] += sign * sd[k + 2] * a;
          V[v + 3] += sign * a;
          V[v + 4] += sign * l;
          V[v + 5] += sign * l * l;
        }
      };
      // V covers rows [t, t + s); ring slot t holds horizontal s-wide sums of V
      // starting at each column, i.e. the s x s box with top-left (x0 + i, t).
      for (let k = 0; k < s; k++) addRow(b.y - r + k, 1);
      for (let t = b.y - r; t < b.y + b.height; t++) {
        if ((t & 31) === 0) checkCancelled(progress);
        const slot = ((t - (b.y - r)) % (r + 1)) * bw * PL;
        for (let c = 0; c < PL; c++) {
          let acc = 0;
          for (let i = 0; i < s - 1 && i < bw; i++) acc += V[i * PL + c];
          for (let i = 0; i < bw; i++) {
            if (i + s - 1 < bw) acc += V[(i + s - 1) * PL + c];
            ring[slot + i * PL + c] = acc;
            acc -= V[i * PL + c];
          }
        }
        addRow(t + s, 1);
        addRow(t, -1);
        const y = t;
        if (y < b.y) continue;
        // Quadrant boxes: top-left corners (x-r, y-r), (x, y-r), (x-r, y), (x, y).
        const top = ((y - r - (b.y - r)) % (r + 1)) * bw * PL,
          bot = slot;
        for (let x = b.x; x < b.x + b.width; x++) {
          const i0 = (x - r - x0) * PL,
            i1 = (x - x0) * PL;
          let bestVar = Infinity,
            bk = 0;
          for (let t = 0; t < 4; t++) {
            const k = (t < 2 ? top : bot) + (t & 1 ? i1 : i0),
              n = s * s,
              mean = ring[k + 4] / n,
              varc = ring[k + 5] / n - mean * mean;
            if (varc < bestVar) ((bestVar = varc), (bk = k));
          }
          const a = ring[bk + 3],
            q = (y * w + x) * 4;
          d[q] = a > 1e-9 ? ring[bk] / a : 0;
          d[q + 1] = a > 1e-9 ? ring[bk + 1] / a : 0;
          d[q + 2] = a > 1e-9 ? ring[bk + 2] / a : 0;
          d[q + 3] = (a / (s * s)) * 255;
        }
      }
    });
  },
};

export const mezzotint: ImageOperation = {
  id: 'mezzotint',
  label: 'Mezzotint',
  category: 'Pixelate',
  params: [
    {
      key: 'type',
      label: 'Type',
      type: 'select',
      options: [
        { value: 'fine-dots', label: 'Fine dots' },
        { value: 'medium-dots', label: 'Medium dots' },
        { value: 'grainy-dots', label: 'Grainy dots' },
        { value: 'coarse-dots', label: 'Coarse dots' },
        { value: 'short-lines', label: 'Short lines' },
        { value: 'medium-lines', label: 'Medium lines' },
        { value: 'long-lines', label: 'Long lines' },
        { value: 'short-strokes', label: 'Short strokes' },
        { value: 'medium-strokes', label: 'Medium strokes' },
        { value: 'long-strokes', label: 'Long strokes' },
      ],
      default: 'fine-dots',
    },
    seedParam,
  ],
  apply(src, p, ctx, progress) {
    // Each channel is thresholded against uniform noise, so on average the
    // fraction of lit pixels equals the channel value. Noise is shaped into
    // dots, horizontal lines or diagonal strokes by hashing cell coordinates.
    const type = str(p, 'type', 'fine-dots'),
      sc = ctx.scale ?? 1,
      seed = seedOf(p, ctx);
    const len = Math.max(1, Math.round((type.startsWith('short') ? 4 : type.startsWith('medium') ? 8 : 16) * sc));
    const dot = Math.max(1, Math.round((type === 'medium-dots' ? 2 : type === 'coarse-dots' ? 4 : 1) * sc));
    const perChannel = type === 'grainy-dots';
    return within(src, ctx, (out, b) => {
      const { width: w, data: s } = src,
        d = out.data;
      for (let y = b.y; y < b.y + b.height; y++) {
        if ((y & 63) === 0) checkCancelled(progress);
        const off = Math.floor(hash3(y, 7, seed) * len);
        for (let x = b.x; x < b.x + b.width; x++) {
          const q = (y * w + x) * 4;
          for (let ch = 0; ch < 3; ch++) {
            const cs = perChannel ? seed + ch * 0x3c6ef372 : seed;
            let n: number;
            if (type.endsWith('lines')) n = hash3(Math.floor((x + off) / len), y, cs);
            else if (type.endsWith('strokes')) {
              const diag = x - y;
              n = hash3(Math.floor((x + y + Math.floor(hash3(diag, 3, cs) * 2 * len)) / (2 * len)), diag, cs);
            } else n = hash3(Math.floor(x / dot), Math.floor(y / dot), cs);
            d[q + ch] = s[q + ch] / 255 > n ? 255 : 0;
          }
        }
      }
    });
  },
};

export const pixelateOps: ImageOperation[] = [
  mosaic,
  crystallize,
  pointillize,
  colorHalftone,
  fragment,
  facet,
  mezzotint,
];
