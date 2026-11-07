/**
 * Centerline strokes for thin regions (line art): a region whose
 * thickness stays under the maximum stroke width is thinned to a
 * one-pixel skeleton, the skeleton is split into branches between end
 * points and junctions, short spurs are pruned, and each branch becomes
 * an open (or closed) path stroked with the region's average thickness.
 */
import { fitChain } from './fit.js';

/**
 * Chamfer (3-4) distance transform: for every pixel, the distance in
 * pixels to the nearest pixel of another region (1 on a region's edge).
 */
export function regionDistance(region, w, h) {
  const n = w * h;
  const d = new Float32Array(n);
  const BIG = 1e9;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const r = region[i];
      const edge = x === 0 || y === 0 || x === w - 1 || y === h - 1 || region[i - 1] !== r || region[i + 1] !== r || region[i - w] !== r || region[i + w] !== r;
      d[i] = edge ? 3 : BIG;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const r = region[i];
      let v = d[i];
      if (x > 0 && region[i - 1] === r) v = Math.min(v, d[i - 1] + 3);
      if (y > 0 && region[i - w] === r) v = Math.min(v, d[i - w] + 3);
      if (x > 0 && y > 0 && region[i - w - 1] === r) v = Math.min(v, d[i - w - 1] + 4);
      if (x < w - 1 && y > 0 && region[i - w + 1] === r) v = Math.min(v, d[i - w + 1] + 4);
      d[i] = v;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      const r = region[i];
      let v = d[i];
      if (x < w - 1 && region[i + 1] === r) v = Math.min(v, d[i + 1] + 3);
      if (y < h - 1 && region[i + w] === r) v = Math.min(v, d[i + w] + 3);
      if (x < w - 1 && y < h - 1 && region[i + w + 1] === r) v = Math.min(v, d[i + w + 1] + 4);
      if (x > 0 && y < h - 1 && region[i + w - 1] === r) v = Math.min(v, d[i + w - 1] + 4);
      d[i] = v;
    }
  }
  for (let i = 0; i < n; i++) d[i] /= 3;
  return d;
}

// Neighbor offsets clockwise from north: P2..P9 in the usual thinning notation.
const NX = [0, 1, 1, 1, 0, -1, -1, -1];
const NY = [-1, -1, 0, 1, 1, 1, 0, -1];

/** Zhang-Suen thinning of a binary mask (Uint8Array, 1 = set) in place. */
export function thin(mask, w, h) {
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : mask[y * w + x]);
  const del = [];
  for (let changed = true, pass = 0; changed && pass < 1000; pass++) {
    changed = false;
    for (let step = 0; step < 2; step++) {
      del.length = 0;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (!mask[y * w + x]) continue;
          const p = NX.map((dx, k) => at(x + dx, y + NY[k]));
          const b = p.reduce((s, v) => s + v, 0);
          if (b < 2 || b > 6) continue;
          let a = 0;
          for (let k = 0; k < 8; k++) if (!p[k] && p[(k + 1) & 7]) a++;
          if (a !== 1) continue;
          if (step === 0 ? p[0] * p[2] * p[4] || p[2] * p[4] * p[6] : p[0] * p[2] * p[6] || p[0] * p[4] * p[6]) continue;
          del.push(y * w + x);
        }
      }
      for (const i of del) mask[i] = 0;
      if (del.length) changed = true;
    }
  }
  return mask;
}

/** Number of separate skeleton branches around a pixel (0-to-1 transitions). */
function crossings(mask, w, h, x, y) {
  let c = 0;
  let any = 0;
  for (let k = 0; k < 8; k++) {
    const a = at(mask, w, h, x + NX[k], y + NY[k]);
    const b = at(mask, w, h, x + NX[(k + 1) & 7], y + NY[(k + 1) & 7]);
    any += a;
    if (!a && b) c++;
  }
  return any === 8 ? 0 : c;
}

function at(mask, w, h, x, y) {
  return x < 0 || y < 0 || x >= w || y >= h ? 0 : mask[y * w + x];
}

/**
 * Skeleton branches as polylines of pixel coordinates (flat [x, y, ...]),
 * each with `closed`. Nodes are end points (one branch) and junctions
 * (three or more).
 */
export function skeletonBranches(mask, w, h) {
  const node = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x]) {
    const c = crossings(mask, w, h, x, y);
    let nb = 0;
    for (let k = 0; k < 8; k++) nb += at(mask, w, h, x + NX[k], y + NY[k]);
    if (c !== 2 || nb === 1 || nb === 0) node[y * w + x] = nb === 0 ? 2 : 1;
  }
  const visited = new Uint8Array(w * h);
  const out = [];
  // Next unvisited skeleton neighbor, 4-neighbors first so diagonal staircases do not branch.
  const step = (x, y, allowNode) => {
    for (const k of [0, 2, 4, 6, 1, 3, 5, 7]) {
      const nx = x + NX[k];
      const ny = y + NY[k];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (!mask[j] || visited[j]) continue;
      if (node[j] && !allowNode) continue;
      return j;
    }
    return -1;
  };
  const trace = (start, first) => {
    const pts = [start % w, (start / w) | 0];
    let cur = first;
    for (;;) {
      const x = cur % w;
      const y = (cur / w) | 0;
      pts.push(x, y);
      if (node[cur]) break;
      visited[cur] = 1;
      let next = step(x, y, false);
      if (next === -1) {
        // Arrive at a node next to us (not the one we started from unless it is a loop).
        for (const k of [0, 2, 4, 6, 1, 3, 5, 7]) {
          const nx = x + NX[k];
          const ny = y + NY[k];
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const j = ny * w + nx;
          if (mask[j] && node[j] && (j !== start || pts.length > 6)) {
            next = j;
            break;
          }
        }
        if (next === -1) break;
      }
      cur = next;
    }
    return pts;
  };
  const linked = new Set();
  for (let i = 0; i < w * h; i++) {
    if (!node[i]) continue;
    const x = i % w;
    const y = (i / w) | 0;
    if (node[i] === 2) continue; // isolated pixel: no stroke
    for (let k = 0; k < 8; k++) {
      const nx = x + NX[k];
      const ny = y + NY[k];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (!mask[j]) continue;
      if (node[j]) {
        // Two nodes side by side form a one-step branch (once).
        const key = Math.min(i, j) * w * h + Math.max(i, j);
        if (!linked.has(key)) {
          linked.add(key);
          out.push({ pts: [x, y, nx, ny], closed: false, open: [true, true] });
        }
        continue;
      }
      if (visited[j]) continue;
      out.push({ pts: trace(i, j), closed: false });
    }
  }
  // Loops without nodes (rings).
  for (let i = 0; i < w * h; i++) {
    if (!mask[i] || visited[i] || node[i]) continue;
    const pts = [];
    let cur = i;
    while (cur !== -1) {
      visited[cur] = 1;
      pts.push(cur % w, (cur / w) | 0);
      cur = step(cur % w, (cur / w) | 0, false);
    }
    if (pts.length >= 6) {
      pts.push(pts[0], pts[1]);
      out.push({ pts, closed: true });
    }
  }
  for (const b of out) {
    const p = b.pts;
    const n = p.length / 2;
    b.startNode = node[p[1] * w + p[0]];
    b.endNode = node[p[(n - 1) * 2 + 1] * w + p[(n - 1) * 2]];
    b.length = n;
  }
  return { branches: out, node };
}

/**
 * Centerline strokes for one region. `region`/`dist` are the full maps;
 * box { x0, y0, x1, y1 } bounds the region. Returns { paths: [geometry],
 * width } in pixel units, or null when the region is too thick.
 */
export function centerline(region, dist, w, id, box, { maxWidth, tolerance, cornerAngle, lineTolerance }) {
  const bw = box.x1 - box.x0;
  const bh = box.y1 - box.y0;
  const mask = new Uint8Array(bw * bh);
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) if (region[(y + box.y0) * w + x + box.x0] === id) mask[y * bw + x] = 1;
  thin(mask, bw, bh);
  const widths = [];
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) if (mask[y * bw + x]) widths.push(Math.max(1, 2 * dist[(y + box.y0) * w + x + box.x0] - 1));
  if (!widths.length) return null;
  widths.sort((a, b) => a - b);
  const p90 = widths[Math.floor(widths.length * 0.9)];
  if (p90 > maxWidth) return null;
  const width = widths[widths.length >> 1];
  const { branches } = skeletonBranches(mask, bw, bh);
  // Prune short spurs hanging off junctions.
  const spur = Math.max(2, width * 1.5);
  const keep = branches.filter((b) => {
    if (b.closed) return true;
    const endA = b.startNode === 1 && countNb(mask, bw, bh, b.pts[0], b.pts[1]) === 1;
    const n = b.pts.length / 2;
    const endB = b.endNode === 1 && countNb(mask, bw, bh, b.pts[(n - 1) * 2], b.pts[(n - 1) * 2 + 1]) === 1;
    if (endA && endB) return true; // a whole stroke
    if ((endA || endB) && b.length < spur) return false;
    return true;
  });
  const paths = [];
  for (const b of keep) {
    const p = b.pts.map((v, i) => v + (i % 2 ? box.y0 : box.x0) + 0.5);
    if (p.length < 4) continue;
    paths.push({ ...fitChain(p, b.closed, { tolerance, cornerAngle, lineTolerance }), closed: b.closed });
  }
  if (!paths.length) return null;
  return { paths, width };
}

function countNb(mask, w, h, x, y) {
  let c = 0;
  for (let k = 0; k < 8; k++) c += at(mask, w, h, x + NX[k], y + NY[k]);
  return c;
}
