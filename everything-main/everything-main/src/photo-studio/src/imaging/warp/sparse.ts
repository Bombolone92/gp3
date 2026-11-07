// Sparse symmetric positive definite systems for mesh deformation: matrices
// are assembled from triplets, reordered with reverse Cuthill-McKee to keep
// the envelope narrow, and factored once with an envelope (skyline) Cholesky
// so every later solve is two cheap triangular sweeps.

/** Symmetric matrix under assembly; only entries with j <= i are stored. */
export class SymmetricBuilder {
  private rows: Map<number, number>[];
  constructor(readonly n: number) {
    this.rows = Array.from({ length: n }, () => new Map());
  }
  /** Add `v` at (i, j) and, for i != j, at (j, i). */
  add(i: number, j: number, v: number) {
    if (j > i) [i, j] = [j, i];
    const row = this.rows[i];
    row.set(j, (row.get(j) ?? 0) + v);
  }
  get(i: number, j: number) {
    if (j > i) [i, j] = [j, i];
    return this.rows[i].get(j) ?? 0;
  }
  /** Lower-triangle entries of row i (column -> value). */
  row(i: number) {
    return this.rows[i];
  }
  /** Neighbour lists of the matrix graph (off-diagonal structure). */
  adjacency(): number[][] {
    const adj: number[][] = Array.from({ length: this.n }, () => []);
    this.rows.forEach((row, i) => {
      for (const j of row.keys())
        if (j !== i) {
          adj[i].push(j);
          adj[j].push(i);
        }
    });
    return adj;
  }
}

/** Reverse Cuthill-McKee ordering: `order[k]` is the original index placed at
 * position k. Each connected component starts from a pseudo-peripheral node. */
export function rcmOrder(adj: number[][]): Int32Array {
  const n = adj.length;
  const order = new Int32Array(n);
  const placed = new Uint8Array(n);
  const degree = adj.map((a) => a.length);
  const level = new Int32Array(n);
  // Breadth-first levels from `start` over unplaced nodes; returns the last
  // node reached at the deepest level (lowest degree) and the depth.
  const bfs = (start: number) => {
    level.fill(-1);
    const queue = [start];
    level[start] = 0;
    let far = start;
    for (let h = 0; h < queue.length; h++) {
      const v = queue[h];
      if (level[v] > level[far] || (level[v] === level[far] && degree[v] < degree[far])) far = v;
      for (const u of adj[v])
        if (!placed[u] && level[u] < 0) {
          level[u] = level[v] + 1;
          queue.push(u);
        }
    }
    return { far, depth: level[far] };
  };
  let k = 0;
  for (let seed = 0; seed < n; seed++) {
    if (placed[seed]) continue;
    // Pseudo-peripheral start: walk to the far end until the depth stops growing.
    let start = seed,
      depth = -1;
    for (let it = 0; it < 4; it++) {
      const r = bfs(start);
      if (r.depth <= depth) break;
      depth = r.depth;
      start = r.far;
    }
    const begin = k;
    order[k++] = start;
    placed[start] = 1;
    for (let h = begin; h < k; h++) {
      const v = order[h];
      const next = adj[v].filter((u) => !placed[u]).sort((a, b) => degree[a] - degree[b]);
      for (const u of next) {
        placed[u] = 1;
        order[k++] = u;
      }
    }
  }
  order.reverse();
  return order;
}

/** Envelope Cholesky factorization L·Lᵀ of a symmetric positive definite
 * matrix, in a fill-reducing order. Row i of L is stored from its first
 * nonzero column `first[i]` to the diagonal. */
export class EnvelopeCholesky {
  readonly n: number;
  private perm: Int32Array; // position -> original index
  private first: Int32Array;
  private offset: Int32Array;
  private L: Float64Array;
  private tmp: Float64Array;
  constructor(a: SymmetricBuilder, order: Int32Array = rcmOrder(a.adjacency())) {
    const n = (this.n = a.n);
    this.perm = order;
    const pos = new Int32Array(n);
    for (let k = 0; k < n; k++) pos[order[k]] = k;
    const first = (this.first = new Int32Array(n));
    for (let k = 0; k < n; k++) first[k] = k;
    for (let i = 0; i < n; i++)
      for (const j of a.row(i).keys()) {
        const pi = pos[i],
          pj = pos[j];
        const r = Math.max(pi, pj),
          c = Math.min(pi, pj);
        if (c < first[r]) first[r] = c;
      }
    const offset = (this.offset = new Int32Array(n + 1));
    for (let k = 0; k < n; k++) offset[k + 1] = offset[k] + (k - first[k] + 1);
    const L = (this.L = new Float64Array(offset[n]));
    for (let i = 0; i < n; i++)
      for (const [j, v] of a.row(i)) {
        const pi = pos[i],
          pj = pos[j];
        const r = Math.max(pi, pj),
          c = Math.min(pi, pj);
        L[offset[r] + c - first[r]] = v;
      }
    // Row-by-row factorization within the envelope.
    for (let i = 0; i < n; i++) {
      const fi = first[i],
        oi = offset[i] - fi;
      for (let j = fi; j < i; j++) {
        const fj = first[j],
          oj = offset[j] - fj;
        let s = L[oi + j];
        for (let k = Math.max(fi, fj); k < j; k++) s -= L[oi + k] * L[oj + k];
        L[oi + j] = s / L[oj + j];
      }
      let d = L[oi + i];
      for (let k = fi; k < i; k++) d -= L[oi + k] * L[oi + k];
      if (!(d > 0)) throw new Error('Matrix is not positive definite.');
      L[oi + i] = Math.sqrt(d);
    }
    this.tmp = new Float64Array(n);
  }
  /** Stored entries of the factor (a measure of its cost). */
  get size() {
    return this.L.length;
  }
  /** Solve A·x = b; `x` may alias `b`. */
  solve(b: ArrayLike<number>, x: Float64Array = new Float64Array(this.n)): Float64Array {
    const { n, perm, first, offset, L } = this;
    const y = this.tmp;
    for (let k = 0; k < n; k++) y[k] = b[perm[k]];
    for (let i = 0; i < n; i++) {
      const fi = first[i],
        oi = offset[i] - fi;
      let s = y[i];
      for (let k = fi; k < i; k++) s -= L[oi + k] * y[k];
      y[i] = s / L[oi + i];
    }
    for (let i = n - 1; i >= 0; i--) {
      const fi = first[i],
        oi = offset[i] - fi;
      const v = (y[i] /= L[oi + i]);
      for (let k = fi; k < i; k++) y[k] -= L[oi + k] * v;
    }
    for (let k = 0; k < n; k++) x[perm[k]] = y[k];
    return x;
  }
}
