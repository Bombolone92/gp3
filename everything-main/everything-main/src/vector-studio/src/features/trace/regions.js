/**
 * Connected regions and despeckling for tracing.
 *
 * components() finds 4-connected areas of equal label. mergeRegions() then
 * merges every area smaller than the noise size into the neighbor it
 * shares the longest border with (smallest areas first, using a heap and a
 * region adjacency graph), so specks disappear without leaving holes. When
 * an image would still produce too many regions, the size limit grows
 * until it fits. The result is a compact region map plus per-region facts.
 */

/** 4-connected components of equal label. Returns { comp, count, label, area }. */
export function components(labels, w, h) {
  const n = w * h;
  const comp = new Int32Array(n).fill(-1);
  const stack = new Int32Array(n);
  const label = [];
  const area = [];
  let count = 0;
  for (let s = 0; s < n; s++) {
    if (comp[s] !== -1) continue;
    const L = labels[s];
    const id = count++;
    let top = 0;
    let a = 0;
    stack[top++] = s;
    comp[s] = id;
    while (top) {
      const i = stack[--top];
      a++;
      const x = i % w;
      if (x > 0 && comp[i - 1] === -1 && labels[i - 1] === L) (comp[i - 1] = id), (stack[top++] = i - 1);
      if (x < w - 1 && comp[i + 1] === -1 && labels[i + 1] === L) (comp[i + 1] = id), (stack[top++] = i + 1);
      if (i >= w && comp[i - w] === -1 && labels[i - w] === L) (comp[i - w] = id), (stack[top++] = i - w);
      if (i + w < n && comp[i + w] === -1 && labels[i + w] === L) (comp[i + w] = id), (stack[top++] = i + w);
    }
    label.push(L);
    area.push(a);
  }
  return { comp, count, label: Int32Array.from(label), area: Int32Array.from(area) };
}

/** Minimal binary min-heap of [key, value] pairs. */
class Heap {
  constructor() {
    this.k = [];
    this.v = [];
  }
  get size() {
    return this.k.length;
  }
  push(key, value) {
    const { k, v } = this;
    let i = k.length;
    k.push(key);
    v.push(value);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p];
      v[i] = v[p];
      i = p;
    }
    k[i] = key;
    v[i] = value;
  }
  pop() {
    const { k, v } = this;
    const top = v[0];
    const lk = k.pop();
    const lv = v.pop();
    if (k.length) {
      let i = 0;
      const n = k.length;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1;
        const c = r < n && k[r] < k[l] ? r : l;
        if (k[c] >= lk) break;
        k[i] = k[c];
        v[i] = v[c];
        i = c;
      }
      k[i] = lk;
      v[i] = lv;
    }
    return top;
  }
  peekKey() {
    return this.k[0];
  }
}

/**
 * Merge small components. opts:
 *   minArea     areas below this many pixels are merged away
 *   maxRegions  grow minArea until at most this many regions remain
 *   distance(labelA, labelB) -> number   color distance to break border ties
 *   keep(label) -> bool    optional: components never merged into others
 * Returns { region: Int32Array (pixel -> region index), regions: [{ label, area }] }.
 */
export function mergeRegions(cc, w, h, { minArea = 1, maxRegions = Infinity, distance = null } = {}) {
  const { comp, count, label, area: area0 } = cc;
  const n = w * h;
  const parent = new Int32Array(count);
  for (let i = 0; i < count; i++) parent[i] = i;
  const area = Int32Array.from(area0);
  const find = (i) => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  let roots = count;
  if (count > 1 && (minArea > 1 || roots > maxRegions)) {
    // Region adjacency graph: shared border length between components.
    const adj = new Array(count);
    const link = (a, b) => {
      let m = adj[a];
      if (!m) m = adj[a] = new Map();
      m.set(b, (m.get(b) || 0) + 1);
      m = adj[b];
      if (!m) m = adj[b] = new Map();
      m.set(a, (m.get(a) || 0) + 1);
    };
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        const i = row + x;
        const c = comp[i];
        if (x + 1 < w && comp[i + 1] !== c) link(c, comp[i + 1]);
        if (y + 1 < h && comp[i + w] !== c) link(c, comp[i + w]);
      }
    }
    const heap = new Heap();
    let limit = Math.max(1, minArea);
    for (let i = 0; i < count; i++) if (area[i] < limit) heap.push(area[i], i);
    const merge = (r) => {
      const m = adj[r];
      if (!m || !m.size) return false;
      let best = -1;
      let bestLen = -1;
      let bestDist = Infinity;
      for (const [nb, len] of m) {
        const d = distance ? distance(label[r], label[nb]) : 0;
        if (len > bestLen || (len === bestLen && d < bestDist)) {
          best = nb;
          bestLen = len;
          bestDist = d;
        }
      }
      const t = best;
      parent[r] = t;
      area[t] += area[r];
      const mt = adj[t];
      mt.delete(r);
      for (const [nb, len] of m) {
        if (nb === t) continue;
        mt.set(nb, (mt.get(nb) || 0) + len);
        const mn = adj[nb];
        mn.delete(r);
        mn.set(t, (mn.get(t) || 0) + len);
      }
      adj[r] = null;
      roots--;
      if (area[t] < limit) heap.push(area[t], t);
      return true;
    };
    for (;;) {
      while (heap.size && heap.peekKey() < limit) {
        const key = heap.pop();
        // Skip entries that are stale (merged away or grown since they were queued).
        if (parent[key] !== key) continue;
        if (area[key] >= limit) continue;
        merge(key);
      }
      if (roots <= maxRegions) break;
      limit = Math.ceil(limit * 1.6) + 1;
      for (let i = 0; i < count; i++) if (parent[i] === i && area[i] < limit) heap.push(area[i], i);
      if (limit > n) break;
    }
  }
  // Compact ids in scan order.
  const index = new Int32Array(count).fill(-1);
  const regions = [];
  const region = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const r = find(comp[i]);
    let id = index[r];
    if (id === -1) {
      id = index[r] = regions.length;
      regions.push({ label: label[r], area: 0 });
    }
    regions[id].area++;
    region[i] = id;
  }
  return { region, regions };
}

/**
 * Per-region facts in one pass: area, bounding box and mean color.
 * Sets { area, x0, y0, x1, y1, r, g, b } on each region (box in pixels,
 * inclusive-exclusive; regions left without pixels get area 0).
 */
export function regionStats(region, regions, w, h, data) {
  const R = regions.length;
  const sums = new Float64Array(R * 4);
  for (const r of regions) {
    r.area = 0;
    r.x0 = w;
    r.y0 = h;
    r.x1 = 0;
    r.y1 = 0;
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const id = region[i];
      const r = regions[id];
      if (x < r.x0) r.x0 = x;
      if (x + 1 > r.x1) r.x1 = x + 1;
      if (y < r.y0) r.y0 = y;
      if (y + 1 > r.y1) r.y1 = y + 1;
      sums[id * 4] += data[i * 4];
      sums[id * 4 + 1] += data[i * 4 + 1];
      sums[id * 4 + 2] += data[i * 4 + 2];
      sums[id * 4 + 3]++;
      r.area++;
    }
  }
  regions.forEach((r, id) => {
    const c = sums[id * 4 + 3] || 1;
    r.r = sums[id * 4] / c;
    r.g = sums[id * 4 + 1] / c;
    r.b = sums[id * 4 + 2] / c;
  });
  return regions;
}

/** Region adjacency (sets of neighbor region ids) for a compact region map. */
export function regionNeighbors(region, R, w, h) {
  const nb = Array.from({ length: R }, () => new Map());
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const a = region[i];
      if (x + 1 < w && region[i + 1] !== a) {
        const b = region[i + 1];
        nb[a].set(b, (nb[a].get(b) || 0) + 1);
        nb[b].set(a, (nb[b].get(a) || 0) + 1);
      }
      if (y + 1 < h && region[i + w] !== a) {
        const b = region[i + w];
        nb[a].set(b, (nb[a].get(b) || 0) + 1);
        nb[b].set(a, (nb[b].get(a) || 0) + 1);
      }
    }
  }
  return nb;
}

/**
 * Relabel pixels: every region `id` with target[id] !== id moves into its
 * target (following chains of targets). Returns the number of moved regions.
 */
export function absorbRegions(region, target) {
  const R = target.length;
  const final = new Int32Array(R);
  let moved = 0;
  for (let id = 0; id < R; id++) {
    let t = id;
    for (let guard = 0; guard < R && target[t] !== t && target[t] >= 0; guard++) t = target[t];
    final[id] = t;
    if (t !== id) moved++;
  }
  if (moved) for (let i = 0; i < region.length; i++) region[i] = final[region[i]];
  return moved;
}
