// Triangle meshes for Pin Warp: a regular grid of square cells covering a
// layer's visible pixels (grown by an expansion margin), each cell split into
// two triangles with alternating diagonals so the mesh bends evenly.
import type { RGBA8 } from '../types';

export type TriMesh = {
  // Interleaved x, y rest positions in source pixels.
  rest: Float64Array;
  // Three vertex indices per triangle, counter-clockwise in y-down space.
  tris: Uint32Array;
  // Cell size in source pixels.
  spacing: number;
};
export type PinDensity = 'fewer' | 'normal' | 'more';
export const PIN_DENSITIES: [PinDensity, string][] = [
  ['fewer', 'Fewer Points'],
  ['normal', 'Normal'],
  ['more', 'More Points'],
];
// Approximate number of cells over the content area for each density.
const CELLS: Record<PinDensity, number> = { fewer: 160, normal: 520, more: 1500 };

/** Cell size for a content area at a density, at least 4 pixels. */
export function meshSpacing(width: number, height: number, density: PinDensity) {
  return Math.max(4, Math.sqrt((width * height) / CELLS[density]));
}

/** Build a mesh over the pixels of `img` whose alpha exceeds `threshold`,
 * grown by `expansion` pixels (negative values are treated as 0; the mesh
 * always keeps a 1 px margin so warped edges stay antialiased). Returns
 * undefined for a fully transparent image. */
export function buildPinMesh(img: RGBA8, density: PinDensity, expansion = 2, threshold = 0): TriMesh | undefined {
  const { width: W, height: H, data } = img;
  // Opaque bounds first: the grid only spans the content.
  let x0 = W,
    y0 = H,
    x1 = -1,
    y1 = -1;
  for (let y = 0; y < H; y++) {
    const row = y * W;
    for (let x = 0; x < W; x++)
      if (data[(row + x) * 4 + 3] > threshold) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        y1 = y;
      }
  }
  if (x1 < 0) return;
  const grow = Math.max(1, expansion);
  const bw = x1 + 1 - x0 + 2 * grow,
    bh = y1 + 1 - y0 + 2 * grow;
  const s = meshSpacing(x1 + 1 - x0, y1 + 1 - y0, density);
  const cols = Math.max(1, Math.ceil(bw / s)),
    rows = Math.max(1, Math.ceil(bh / s));
  // Centre the grid on the grown bounds.
  const ox = x0 - grow - (cols * s - bw) / 2,
    oy = y0 - grow - (rows * s - bh) / 2;
  // Per cell: bounding box of its opaque pixels (empty when minX > maxX).
  const n = cols * rows;
  const bx0 = new Float64Array(n).fill(Infinity),
    by0 = new Float64Array(n).fill(Infinity),
    bx1 = new Float64Array(n).fill(-Infinity),
    by1 = new Float64Array(n).fill(-Infinity);
  for (let y = y0; y <= y1; y++) {
    const cy = Math.min(rows - 1, Math.floor((y + 0.5 - oy) / s)),
      row = y * W;
    for (let x = x0; x <= x1; x++) {
      if (data[(row + x) * 4 + 3] <= threshold) continue;
      const c = cy * cols + Math.min(cols - 1, Math.floor((x + 0.5 - ox) / s));
      if (x < bx0[c]) bx0[c] = x;
      if (x + 1 > bx1[c]) bx1[c] = x + 1;
      if (y < by0[c]) by0[c] = y;
      if (y + 1 > by1[c]) by1[c] = y + 1;
    }
  }
  // A cell joins the mesh when the grown box of any occupied cell overlaps it.
  const inside = new Uint8Array(n);
  for (let c = 0; c < n; c++) {
    if (bx0[c] > bx1[c]) continue;
    const i0 = Math.max(0, Math.floor((bx0[c] - grow - ox) / s)),
      i1 = Math.min(cols - 1, Math.ceil((bx1[c] + grow - ox) / s) - 1),
      j0 = Math.max(0, Math.floor((by0[c] - grow - oy) / s)),
      j1 = Math.min(rows - 1, Math.ceil((by1[c] + grow - oy) / s) - 1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) inside[j * cols + i] = 1;
  }
  const index = new Int32Array((cols + 1) * (rows + 1)).fill(-1);
  const rest: number[] = [],
    tris: number[] = [];
  const vertex = (i: number, j: number) => {
    const k = j * (cols + 1) + i;
    if (index[k] < 0) {
      index[k] = rest.length / 2;
      rest.push(ox + i * s, oy + j * s);
    }
    return index[k];
  };
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      if (!inside[j * cols + i]) continue;
      const a = vertex(i, j),
        b = vertex(i + 1, j),
        c = vertex(i + 1, j + 1),
        d = vertex(i, j + 1);
      // Alternate the diagonal in a checkerboard so the mesh has no bias.
      if ((i + j) % 2) tris.push(a, d, b, b, d, c);
      else tris.push(a, d, c, a, c, b);
    }
  return { rest: new Float64Array(rest), tris: new Uint32Array(tris), spacing: s };
}

/** Triangle containing (x, y) for vertex positions `pos`, with barycentric
 * weights; the nearest triangle (clamped weights) within `slack` pixels when
 * the point is just outside. Later triangles win where the mesh overlaps
 * itself, matching the drawing order passed in `order`. */
export function locateInMesh(
  pos: Float64Array,
  tris: Uint32Array,
  x: number,
  y: number,
  slack = 0,
  order?: ArrayLike<number>,
): { tri: number; bary: [number, number, number] } | undefined {
  const m = tris.length / 3;
  let found: { tri: number; bary: [number, number, number] } | undefined;
  let bestOut = slack * slack;
  let near: { tri: number; bary: [number, number, number] } | undefined;
  for (let k = 0; k < m; k++) {
    const t = order ? order[k] : k;
    const a = tris[t * 3],
      b = tris[t * 3 + 1],
      c = tris[t * 3 + 2];
    const ax = pos[a * 2],
      ay = pos[a * 2 + 1],
      bx = pos[b * 2],
      by = pos[b * 2 + 1],
      cx = pos[c * 2],
      cy = pos[c * 2 + 1];
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (Math.abs(area) < 1e-12) continue;
    const w0 = ((bx - x) * (cy - y) - (by - y) * (cx - x)) / area,
      w1 = ((cx - x) * (ay - y) - (cy - y) * (ax - x)) / area,
      w2 = 1 - w0 - w1;
    if (w0 >= -1e-9 && w1 >= -1e-9 && w2 >= -1e-9) {
      found = { tri: t, bary: [w0, w1, w2] };
      continue;
    }
    if (found || !slack) continue;
    // Distance to the triangle, approximated by its nearest edge.
    const d = Math.min(segDist2(x, y, ax, ay, bx, by), segDist2(x, y, bx, by, cx, cy), segDist2(x, y, cx, cy, ax, ay));
    if (d <= bestOut) {
      bestOut = d;
      const c0 = Math.max(0, w0),
        c1 = Math.max(0, w1),
        c2 = Math.max(0, w2),
        sum = c0 + c1 + c2 || 1;
      near = { tri: t, bary: [c0 / sum, c1 / sum, c2 / sum] };
    }
  }
  return found ?? near;
}
function segDist2(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax,
    dy = by - ay,
    l = dx * dx + dy * dy;
  const t = l ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l)) : 0;
  return (ax + t * dx - px) ** 2 + (ay + t * dy - py) ** 2;
}
/** Point inside triangle `tri` at barycentric weights `bary`. */
export function meshPoint(pos: Float64Array, tris: Uint32Array, tri: number, bary: readonly number[]) {
  const a = tris[tri * 3],
    b = tris[tri * 3 + 1],
    c = tris[tri * 3 + 2];
  return {
    x: bary[0] * pos[a * 2] + bary[1] * pos[b * 2] + bary[2] * pos[c * 2],
    y: bary[0] * pos[a * 2 + 1] + bary[1] * pos[b * 2 + 1] + bary[2] * pos[c * 2 + 1],
  };
}
/** Unique undirected edges, as vertex index pairs (for drawing the mesh). */
export function meshEdges(tris: Uint32Array): Uint32Array {
  const seen = new Set<number>();
  const out: number[] = [];
  for (let t = 0; t < tris.length; t += 3)
    for (let e = 0; e < 3; e++) {
      const a = tris[t + e],
        b = tris[t + ((e + 1) % 3)];
      const lo = Math.min(a, b),
        hi = Math.max(a, b);
      const key = lo * 0x100000 + hi;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(lo, hi);
    }
  return new Uint32Array(out);
}
