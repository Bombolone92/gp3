// Membrane (Laplace) interpolation with Dirichlet values on an irregular domain,
// solved with geometric multigrid V-cycles (correction scheme, Gauss-Seidel
// smoothing, coarse cells that touch the boundary held at zero error). This is
// the solver behind seamless cloning (Pérez, Gangnet and Blake, "Poisson Image
// Editing", SIGGRAPH 2003): healing solves for the smooth correction
// f = dst - src that matches the destination on the boundary.

export const IGNORE = 0, KNOWN = 1, UNKNOWN = 2;

type Level = {
  w: number;
  h: number;
  type: Uint8Array;
  idx: Int32Array; // unknown cells
  nbr: Int32Array; // up to 4 unknown neighbours per unknown cell, -1 padded
  cnt: Uint8Array; // known + unknown neighbour count (the diagonal)
  x: Float32Array; // solution (finest) or error (coarser), C interleaved
  b: Float32Array; // right-hand side
};

function makeLevel(w: number, h: number, type: Uint8Array, C: number): Level {
  const n = w * h, cells: number[] = [];
  for (let i = 0; i < n; i++) if (type[i] === UNKNOWN) cells.push(i);
  const idx = Int32Array.from(cells), nbr = new Int32Array(idx.length * 4).fill(-1), cnt = new Uint8Array(idx.length);
  for (let k = 0; k < idx.length; k++) {
    const i = idx[k], x = i % w;
    let m = 0, c = 0;
    const visit = (j: number) => {
      const t = type[j];
      if (!t) return;
      c++;
      if (t === UNKNOWN) nbr[k * 4 + m++] = j;
    };
    if (x > 0) visit(i - 1);
    if (x < w - 1) visit(i + 1);
    if (i >= w) visit(i - w);
    if (i + w < n) visit(i + w);
    cnt[k] = c;
  }
  return { w, h, type, idx, nbr, cnt, x: new Float32Array(n * C), b: new Float32Array(n * C) };
}

function coarsen(f: Level, C: number): Level {
  const w = (f.w + 1) >> 1, h = (f.h + 1) >> 1, type = new Uint8Array(w * h);
  for (let y = 0; y < f.h; y++)
    for (let x = 0; x < f.w; x++) {
      const t = f.type[y * f.w + x], o = (y >> 1) * w + (x >> 1);
      // Known wins: the error is zero wherever the boundary is.
      if (t === KNOWN) type[o] = KNOWN;
      else if (t === UNKNOWN && type[o] !== KNOWN) type[o] = UNKNOWN;
    }
  return makeLevel(w, h, type, C);
}

function smooth(L: Level, C: number, iters: number, omega: number) {
  const { idx, nbr, cnt, x, b } = L, n = idx.length;
  for (let it = 0; it < iters; it++) {
    const fwd = (it & 1) === 0;
    for (let s = 0; s < n; s++) {
      const k = fwd ? s : n - 1 - s, d = cnt[k];
      if (!d) continue;
      const i = idx[k], q = k * 4, n0 = nbr[q], n1 = nbr[q + 1], n2 = nbr[q + 2], n3 = nbr[q + 3];
      for (let c = 0; c < C; c++) {
        let sum = b[i * C + c];
        if (n0 >= 0) sum += x[n0 * C + c];
        if (n1 >= 0) sum += x[n1 * C + c];
        if (n2 >= 0) sum += x[n2 * C + c];
        if (n3 >= 0) sum += x[n3 * C + c];
        x[i * C + c] += omega * (sum / d - x[i * C + c]);
      }
    }
  }
}

// r = b - A x on unknown cells, summed into the parent coarse cells' b.
function restrictResidual(f: Level, g: Level, C: number) {
  g.b.fill(0);
  g.x.fill(0);
  const { idx, nbr, cnt, x, b } = f;
  for (let k = 0; k < idx.length; k++) {
    const i = idx[k], px = i % f.w, py = (i - px) / f.w, o = (py >> 1) * g.w + (px >> 1);
    if (g.type[o] !== UNKNOWN) continue;
    const q = k * 4;
    for (let c = 0; c < C; c++) {
      let ax = cnt[k] * x[i * C + c];
      for (let j = 0; j < 4; j++) if (nbr[q + j] >= 0) ax -= x[nbr[q + j] * C + c];
      g.b[o * C + c] += b[i * C + c] - ax;
    }
  }
}

// Bilinear prolongation of the coarse error onto fine unknowns.
function addCorrection(f: Level, g: Level, C: number) {
  const acc = new Float64Array(C);
  for (let k = 0; k < f.idx.length; k++) {
    const i = f.idx[k], x = i % f.w, y = (i - x) / f.w;
    const gx = (x - 0.5) / 2, gy = (y - 0.5) / 2, x0 = Math.floor(gx), y0 = Math.floor(gy);
    let ws = 0;
    acc.fill(0);
    for (let dy = 0; dy < 2; dy++)
      for (let dx = 0; dx < 2; dx++) {
        const xx = x0 + dx, yy = y0 + dy;
        if (xx < 0 || yy < 0 || xx >= g.w || yy >= g.h) continue;
        const j = yy * g.w + xx, t = g.type[j];
        if (!t) continue;
        const wgt = (dx ? gx - x0 : 1 - (gx - x0)) * (dy ? gy - y0 : 1 - (gy - y0)) + 1e-6;
        ws += wgt;
        if (t === UNKNOWN) for (let c = 0; c < C; c++) acc[c] += g.x[j * C + c] * wgt;
      }
    if (ws > 0) for (let c = 0; c < C; c++) f.x[i * C + c] += acc[c] / ws;
  }
}

function vcycle(levels: Level[], l: number, C: number) {
  const L = levels[l];
  if (l === levels.length - 1) {
    smooth(L, C, Math.max(40, 2 * (L.w + L.h)), 1.5);
    return;
  }
  smooth(L, C, 3, 1.15);
  restrictResidual(L, levels[l + 1], C);
  vcycle(levels, l + 1, C);
  addCorrection(L, levels[l + 1], C);
  smooth(L, C, 3, 1.15);
}

function setRhs(L: Level, val: Float32Array, C: number) {
  const { w, h, type, idx, b } = L;
  b.fill(0);
  for (let k = 0; k < idx.length; k++) {
    const i = idx[k], x = i % w;
    const add = (j: number) => {
      if (type[j] !== KNOWN) return;
      for (let c = 0; c < C; c++) b[i * C + c] += val[j * C + c];
    };
    if (x > 0) add(i - 1);
    if (x < w - 1) add(i + 1);
    if (i >= w) add(i - w);
    if (i + w < w * h) add(i + w);
  }
}

// Fills UNKNOWN cells of `val` (C interleaved channels) in place. KNOWN cells
// are Dirichlet values; IGNORE cells are outside the domain (free edges).
// Full multigrid: a coarse-to-fine solve of the restricted problem gives the
// starting guess, then V-cycles remove the remaining error.
export function solveMembrane(val: Float32Array, type: Uint8Array, w: number, h: number, C: number, cycles = 2) {
  const fine = makeLevel(w, h, type, C);
  if (!fine.idx.length) return val;
  const levels = [fine];
  while (levels.length < 14) {
    const top = levels[levels.length - 1];
    if (top.idx.length <= 64 || (top.w <= 3 && top.h <= 3)) break;
    const next = coarsen(top, C);
    if (!next.idx.length) break;
    levels.push(next);
  }
  // Dirichlet values per level: the average of the known children.
  const vals = [val];
  for (let l = 1; l < levels.length; l++) {
    const f = levels[l - 1], g = levels[l], v = new Float32Array(g.w * g.h * C), cnt = new Float32Array(g.w * g.h), fv = vals[l - 1];
    for (let y = 0; y < f.h; y++)
      for (let x = 0; x < f.w; x++) {
        const i = y * f.w + x;
        if (f.type[i] !== KNOWN) continue;
        const o = (y >> 1) * g.w + (x >> 1);
        cnt[o]++;
        for (let c = 0; c < C; c++) v[o * C + c] += fv[i * C + c];
      }
    for (let o = 0; o < cnt.length; o++) if (cnt[o]) for (let c = 0; c < C; c++) v[o * C + c] /= cnt[o];
    vals.push(v);
  }
  const acc = new Float64Array(C);
  for (let l = levels.length - 1; l >= 0; l--) {
    const L = levels[l], v = vals[l];
    setRhs(L, v, C);
    if (l === levels.length - 1) {
      const mean = new Float64Array(C);
      let nk = 0;
      for (let i = 0; i < L.w * L.h; i++)
        if (L.type[i] === KNOWN) {
          nk++;
          for (let c = 0; c < C; c++) mean[c] += v[i * C + c];
        }
      for (const i of L.idx) for (let c = 0; c < C; c++) L.x[i * C + c] = nk ? mean[c] / nk : 0;
      smooth(L, C, Math.max(60, 3 * (L.w + L.h)), 1.5);
      continue;
    }
    const g = levels[l + 1], gv = vals[l + 1];
    for (const i of L.idx) {
      const x = i % L.w, y = (i - x) / L.w, gx = (x - 0.5) / 2, gy = (y - 0.5) / 2, x0 = Math.floor(gx), y0 = Math.floor(gy);
      let ws = 0;
      acc.fill(0);
      for (let dy = 0; dy < 2; dy++)
        for (let dx = 0; dx < 2; dx++) {
          const xx = x0 + dx, yy = y0 + dy;
          if (xx < 0 || yy < 0 || xx >= g.w || yy >= g.h) continue;
          const j = yy * g.w + xx, t = g.type[j];
          if (!t) continue;
          const wgt = (dx ? gx - x0 : 1 - (gx - x0)) * (dy ? gy - y0 : 1 - (gy - y0)) + 1e-6, src = t === KNOWN ? gv : g.x;
          ws += wgt;
          for (let c = 0; c < C; c++) acc[c] += src[j * C + c] * wgt;
        }
      if (ws > 0) for (let c = 0; c < C; c++) L.x[i * C + c] = acc[c] / ws;
    }
    vcycle(levels, l, C);
  }
  for (let k = 0; k < cycles; k++) vcycle(levels, 0, C);
  for (const i of fine.idx) for (let c = 0; c < C; c++) val[i * C + c] = fine.x[i * C + c];
  return val;
}
