// Boykov-Kolmogorov max-flow / min-cut ("An Experimental Comparison of Min-Cut/
// Max-Flow Algorithms for Energy Minimization in Vision", PAMI 2004), specialised
// to image grids: neighbours are implicit offsets, so the graph costs a few typed
// arrays and no per-edge objects. Capacities are integers so residual tests are exact.

const TERMINAL = -2, ORPHAN = -3;
// Neighbour directions in reverse pairs (k ^ 1 is the opposite direction).
const DX = [1, -1, 0, 0, 1, -1, 1, -1], DY = [0, 0, 1, -1, 1, -1, -1, 1];
export const INF_CAP = 1 << 28;

export class GridGraph {
  readonly n: number;
  // Residual capacity of the edge from node i in direction k: cap[i * K + k].
  readonly cap: Int32Array;
  // Net terminal capacity: positive links to the source, negative to the sink.
  readonly tr: Int32Array;
  readonly off: Int32Array;
  private readonly nb: Uint8Array;
  private readonly tree: Uint8Array;
  private readonly parent: Int8Array;
  private readonly ts: Int32Array;
  private readonly dist: Int32Array;
  constructor(readonly w: number, readonly h: number, readonly K: 4 | 8 = 4) {
    const n = (this.n = w * h);
    this.cap = new Int32Array(n * K);
    this.tr = new Int32Array(n);
    this.off = new Int32Array(K);
    for (let k = 0; k < K; k++) this.off[k] = DY[k] * w + DX[k];
    this.nb = new Uint8Array(n);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let m = 0;
        for (let k = 0; k < K; k++) {
          const xx = x + DX[k], yy = y + DY[k];
          if (xx >= 0 && yy >= 0 && xx < w && yy < h) m |= 1 << k;
        }
        this.nb[y * w + x] = m;
      }
    this.tree = new Uint8Array(n);
    this.parent = new Int8Array(n);
    this.ts = new Int32Array(n);
    this.dist = new Int32Array(n);
  }
  static dx(k: number) {
    return DX[k];
  }
  static dy(k: number) {
    return DY[k];
  }
  // Symmetric edge between node i and its neighbour in direction k.
  setEdge(i: number, k: number, c: number) {
    if (!(this.nb[i] & (1 << k))) return;
    this.cap[i * this.K + k] = c;
    this.cap[(i + this.off[k]) * this.K + (k ^ 1)] = c;
  }
  // True when node i ends on the source side of the minimum cut.
  isSource(i: number) {
    return this.tree[i] === 1;
  }

  maxflow(): number {
    const { n, K, cap, tr, off, nb, tree, parent, ts, dist } = this;
    const queue = new Int32Array(n), active = new Uint8Array(n);
    let qh = 0, qt = 0, qn = 0;
    const activate = (i: number) => {
      if (active[i]) return;
      active[i] = 1;
      queue[qt] = i;
      qt = qt + 1 === n ? 0 : qt + 1;
      qn++;
    };
    const orphans = new Int32Array(n);
    let oh = 0, ot = 0, on = 0;
    const orphan = (i: number) => {
      parent[i] = ORPHAN;
      orphans[ot] = i;
      ot = ot + 1 === n ? 0 : ot + 1;
      on++;
    };
    tree.fill(0);
    for (let i = 0; i < n; i++) {
      if (tr[i] !== 0) {
        tree[i] = tr[i] > 0 ? 1 : 2;
        parent[i] = TERMINAL;
        ts[i] = 0;
        dist[i] = 1;
        activate(i);
      }
    }
    let flow = 0, time = 0, cur = -1;
    for (;;) {
      if (cur >= 0 && !tree[cur]) cur = -1;
      if (cur < 0) {
        while (qn) {
          const i = queue[qh];
          qh = qh + 1 === n ? 0 : qh + 1;
          qn--;
          active[i] = 0;
          if (tree[i]) {
            cur = i;
            break;
          }
        }
        if (cur < 0) break;
      }
      // Growth: find an edge from the source tree to the sink tree.
      const i = cur, m = nb[i], ti = tree[i];
      let sNode = -1, dir = -1;
      if (ti === 1) {
        for (let k = 0; k < K; k++) {
          if (!(m & (1 << k)) || cap[i * K + k] === 0) continue;
          const j = i + off[k], tj = tree[j];
          if (!tj) {
            tree[j] = 1;
            parent[j] = k ^ 1;
            ts[j] = ts[i];
            dist[j] = dist[i] + 1;
            activate(j);
          } else if (tj === 2) {
            sNode = i;
            dir = k;
            break;
          } else if (ts[j] <= ts[i] && dist[j] > dist[i]) {
            parent[j] = k ^ 1;
            ts[j] = ts[i];
            dist[j] = dist[i] + 1;
          }
        }
      } else {
        for (let k = 0; k < K; k++) {
          if (!(m & (1 << k))) continue;
          const j = i + off[k];
          if (cap[j * K + (k ^ 1)] === 0) continue;
          const tj = tree[j];
          if (!tj) {
            tree[j] = 2;
            parent[j] = k ^ 1;
            ts[j] = ts[i];
            dist[j] = dist[i] + 1;
            activate(j);
          } else if (tj === 1) {
            sNode = j;
            dir = k ^ 1;
            break;
          } else if (ts[j] <= ts[i] && dist[j] > dist[i]) {
            parent[j] = k ^ 1;
            ts[j] = ts[i];
            dist[j] = dist[i] + 1;
          }
        }
      }
      time++;
      if (sNode < 0) {
        cur = -1;
        continue;
      }
      // Augment along source-root -> sNode -> tNode -> sink-root.
      const tNode = sNode + off[dir];
      let f = cap[sNode * K + dir];
      let u = sNode;
      while (parent[u] !== TERMINAL) {
        const a = parent[u], p = u + off[a], c = cap[p * K + (a ^ 1)];
        if (c < f) f = c;
        u = p;
      }
      if (tr[u] < f) f = tr[u];
      u = tNode;
      while (parent[u] !== TERMINAL) {
        const a = parent[u], c = cap[u * K + a];
        if (c < f) f = c;
        u += off[a];
      }
      if (-tr[u] < f) f = -tr[u];
      cap[sNode * K + dir] -= f;
      cap[tNode * K + (dir ^ 1)] += f;
      u = sNode;
      for (;;) {
        const a = parent[u];
        if (a === TERMINAL) {
          tr[u] -= f;
          if (!tr[u]) orphan(u);
          break;
        }
        const p = u + off[a], e = p * K + (a ^ 1);
        cap[e] -= f;
        cap[u * K + a] += f;
        if (!cap[e]) orphan(u);
        u = p;
      }
      u = tNode;
      for (;;) {
        const a = parent[u];
        if (a === TERMINAL) {
          tr[u] += f;
          if (!tr[u]) orphan(u);
          break;
        }
        const p = u + off[a], e = u * K + a;
        cap[e] -= f;
        cap[p * K + (a ^ 1)] += f;
        if (!cap[e]) orphan(u);
        u = p;
      }
      flow += f;
      // Adoption: reattach orphans to their tree or free them.
      while (on) {
        const o = orphans[oh];
        oh = oh + 1 === n ? 0 : oh + 1;
        on--;
        const t = tree[o], mo = nb[o];
        let best = -1, dmin = 0x7fffffff;
        for (let a = 0; a < K; a++) {
          if (!(mo & (1 << a))) continue;
          const p = o + off[a];
          if (tree[p] !== t) continue;
          if ((t === 1 ? cap[p * K + (a ^ 1)] : cap[o * K + a]) === 0) continue;
          // Is p still rooted at a terminal? Walk up, reusing this round's stamps.
          let j = p, d = 0, ok = true;
          for (;;) {
            if (ts[j] === time) {
              d += dist[j];
              break;
            }
            const pa = parent[j];
            d++;
            if (pa === TERMINAL) {
              ts[j] = time;
              dist[j] = 1;
              break;
            }
            if (pa === ORPHAN) {
              ok = false;
              break;
            }
            j += off[pa];
          }
          if (!ok) continue;
          if (d < dmin) {
            dmin = d;
            best = a;
          }
          for (j = p; ts[j] !== time; j += off[parent[j]]) {
            ts[j] = time;
            dist[j] = d--;
          }
        }
        if (best >= 0) {
          parent[o] = best;
          ts[o] = time;
          dist[o] = dmin + 1;
        } else {
          for (let a = 0; a < K; a++) {
            if (!(mo & (1 << a))) continue;
            const p = o + off[a];
            if (tree[p] !== t) continue;
            if ((t === 1 ? cap[p * K + (a ^ 1)] : cap[o * K + a]) > 0) activate(p);
            const pa = parent[p];
            if (pa >= 0 && p + off[pa] === o) orphan(p);
          }
          tree[o] = 0;
        }
      }
    }
    return flow;
  }
}
