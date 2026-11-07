/**
 * Gradient mesh geometry and color.
 *
 * A mesh node is a grid of Coons patches:
 *
 *   { type: 'mesh', rows, cols, points: [...] }
 *
 * `points` holds (rows + 1) * (cols + 1) mesh points in row-major order.
 * Each is { x, y, c, a, lx, ly, rx, ry, ux, uy, dx, dy }: its position,
 * color ('#rrggbb') and opacity (0..1), and four absolute direction handles
 * (left, right, up, down) shaping the mesh lines that leave it. The edge
 * from point (i, j) to (i, j + 1) is the cubic P, P.r, Q.l, Q; the edge
 * from (i, j) to (i + 1, j) is P, P.d, Q.u, Q. Handles that point out of
 * the grid are unused and kept on their point.
 *
 * Patch (i, j) spans rows i..i+1 and columns j..j+1 with parameters s
 * (across, left to right) and t (down). Its surface is the bilinearly
 * blended Coons patch of its four edges, and its color is the bilinear
 * blend of its corner colors in (s, t), which is exactly what a PDF
 * Coons patch mesh shading (type 6) draws.
 */
import { pointAt, derivativeAt, split, nearestOnCubic, signedArea, reverseAnchors, insertAnchor, segmentPoints, pathBounds, cubicBounds } from '../../model/bezier.js';
import { hexToRgb, rgbToHex } from '../../lib/color.js';
import { apply } from '../../lib/matrix.js';
import { uid } from '../../lib/ids.js';

export const idx = (m, i, j) => i * (m.cols + 1) + j;
export const pointAtGrid = (m, i, j) => m.points[idx(m, i, j)];
/** Grid row and column of a point index. */
export const rowCol = (m, k) => [Math.floor(k / (m.cols + 1)), k % (m.cols + 1)];

/** A mesh point with retracted handles. */
export function meshPoint(x, y, c = '#ffffff', a = 1) {
  return { x, y, c, a, lx: x, ly: y, rx: x, ry: y, ux: x, uy: y, dx: x, dy: y };
}

/** A new mesh node from a grid of points. */
export function createMesh(rows, cols, points, extra = {}) {
  return { id: uid('m'), type: 'mesh', name: '', rows, cols, points, hidden: false, locked: false, opacity: 1, blendMode: 'normal', effects: [], ...extra };
}

/** Horizontal edge on row i from column j to j + 1, as cubic control points. */
export function hEdge(m, i, j) {
  const p = pointAtGrid(m, i, j);
  const q = pointAtGrid(m, i, j + 1);
  return [p.x, p.y, p.rx, p.ry, q.lx, q.ly, q.x, q.y];
}

/** Vertical edge on column j from row i to i + 1. */
export function vEdge(m, i, j) {
  const p = pointAtGrid(m, i, j);
  const q = pointAtGrid(m, i + 1, j);
  return [p.x, p.y, p.dx, p.dy, q.ux, q.uy, q.x, q.y];
}

/** The four edges and corners of patch (i, j): A top-left, B top-right, C bottom-right, D bottom-left. */
export function patchOf(m, i, j) {
  return {
    top: hEdge(m, i, j),
    bottom: hEdge(m, i + 1, j),
    left: vEdge(m, i, j),
    right: vEdge(m, i, j + 1),
    A: pointAtGrid(m, i, j),
    B: pointAtGrid(m, i, j + 1),
    C: pointAtGrid(m, i + 1, j + 1),
    D: pointAtGrid(m, i + 1, j),
  };
}

function cub(c, o, t) {
  const mt = 1 - t;
  return mt * mt * mt * c[o] + 3 * mt * mt * t * c[o + 2] + 3 * mt * t * t * c[o + 4] + t * t * t * c[o + 6];
}

/** Point of a Coons patch (as from patchOf) at (s, t). */
export function evalPatch(p, s, t) {
  const { top, bottom, left, right, A, B, C, D } = p;
  const us = 1 - s;
  const ut = 1 - t;
  const x = ut * cub(top, 0, s) + t * cub(bottom, 0, s) + us * cub(left, 0, t) + s * cub(right, 0, t) - (us * ut * A.x + s * ut * B.x + us * t * D.x + s * t * C.x);
  const y = ut * cub(top, 1, s) + t * cub(bottom, 1, s) + us * cub(left, 1, t) + s * cub(right, 1, t) - (us * ut * A.y + s * ut * B.y + us * t * D.y + s * t * C.y);
  return { x, y };
}

/** Partial derivatives { su: dS/ds, tv: dS/dt } of a Coons patch at (s, t). */
export function patchDerivatives(p, s, t) {
  const { top, bottom, left, right, A, B, C, D } = p;
  const ts = derivativeAt(top, s);
  const bs = derivativeAt(bottom, s);
  const lt = derivativeAt(left, t);
  const rt = derivativeAt(right, t);
  const L = pointAt(left, t);
  const R = pointAt(right, t);
  const T = pointAt(top, s);
  const Bo = pointAt(bottom, s);
  const ut = 1 - t;
  const us = 1 - s;
  return {
    su: {
      x: ut * ts.x + t * bs.x - L.x + R.x - (-ut * A.x + ut * B.x - t * D.x + t * C.x),
      y: ut * ts.y + t * bs.y - L.y + R.y - (-ut * A.y + ut * B.y - t * D.y + t * C.y),
    },
    tv: {
      x: -T.x + Bo.x + us * lt.x + s * rt.x - (-us * A.x - s * B.x + us * D.x + s * C.x),
      y: -T.y + Bo.y + us * lt.y + s * rt.y - (-us * A.y - s * B.y + us * D.y + s * C.y),
    },
  };
}

/** A point's color as [r, g, b, a] with channels 0..255 and alpha 0..1. */
export function rgba(pt) {
  const { r, g, b } = hexToRgb(pt.c);
  return [r, g, b, pt.a ?? 1];
}

/** Bilinear color of patch (i, j) at (s, t) as [r, g, b, a]. */
export function patchColor(m, i, j, s, t) {
  const A = rgba(pointAtGrid(m, i, j));
  const B = rgba(pointAtGrid(m, i, j + 1));
  const C = rgba(pointAtGrid(m, i + 1, j + 1));
  const D = rgba(pointAtGrid(m, i + 1, j));
  const out = [];
  for (let k = 0; k < 4; k++) out.push((1 - s) * (1 - t) * A[k] + s * (1 - t) * B[k] + (1 - s) * t * D[k] + s * t * C[k]);
  return out;
}

/** Linear blend of two colors given as hex, with their opacities: { c, a }. */
function blendPoints(p, q, t) {
  const A = hexToRgb(p.c);
  const B = hexToRgb(q.c);
  return { c: rgbToHex({ r: A.r + (B.r - A.r) * t, g: A.g + (B.g - A.g) * t, b: A.b + (B.b - A.b) * t }), a: (p.a ?? 1) + ((q.a ?? 1) - (p.a ?? 1)) * t };
}

// ---- outline ----

/**
 * The mesh outline as a closed anchor list, clockwise from the top-left
 * corner: along row 0, down the last column, back along the last row and
 * up column 0.
 */
export function meshBoundary(m) {
  const out = [];
  const { rows: R, cols: C } = m;
  const add = (p, ix, iy, ox, oy) => out.push({ x: p.x, y: p.y, ix, iy, ox, oy });
  for (let j = 0; j < C; j++) {
    const p = pointAtGrid(m, 0, j);
    if (j === 0) add(p, p.dx, p.dy, p.rx, p.ry);
    else add(p, p.lx, p.ly, p.rx, p.ry);
  }
  for (let i = 0; i < R; i++) {
    const p = pointAtGrid(m, i, C);
    if (i === 0) add(p, p.lx, p.ly, p.dx, p.dy);
    else add(p, p.ux, p.uy, p.dx, p.dy);
  }
  for (let j = C; j > 0; j--) {
    const p = pointAtGrid(m, R, j);
    if (j === C) add(p, p.ux, p.uy, p.lx, p.ly);
    else add(p, p.rx, p.ry, p.lx, p.ly);
  }
  for (let i = R; i > 0; i--) {
    const p = pointAtGrid(m, i, 0);
    if (i === R) add(p, p.rx, p.ry, p.ux, p.uy);
    else add(p, p.dx, p.dy, p.ux, p.uy);
  }
  return out;
}

/** Geometric bounds of the mesh (its outline). */
export function meshBounds(m) {
  return pathBounds(meshBoundary(m), true);
}

/** Every edge cubic: [{ kind: 'h'|'v', i, j, c }]. */
export function meshEdges(m) {
  const out = [];
  for (let i = 0; i <= m.rows; i++) for (let j = 0; j < m.cols; j++) out.push({ kind: 'h', i, j, c: hEdge(m, i, j) });
  for (let i = 0; i < m.rows; i++) for (let j = 0; j <= m.cols; j++) out.push({ kind: 'v', i, j, c: vEdge(m, i, j) });
  return out;
}

// ---- transforms ----

/** Points after an affine matrix. */
export function transformPoints(points, mat) {
  const [a, b, c, d, e, f] = mat;
  const X = (x, y) => a * x + c * y + e;
  const Y = (x, y) => b * x + d * y + f;
  return points.map((p) => ({
    ...p,
    x: X(p.x, p.y),
    y: Y(p.x, p.y),
    lx: X(p.lx, p.ly),
    ly: Y(p.lx, p.ly),
    rx: X(p.rx, p.ry),
    ry: Y(p.rx, p.ry),
    ux: X(p.ux, p.uy),
    uy: Y(p.ux, p.uy),
    dx: X(p.dx, p.dy),
    dy: Y(p.dx, p.dy),
  }));
}

/** A point moved by (dx, dy) with its handles. */
export function movePoint(p, ddx, ddy) {
  return { ...p, x: p.x + ddx, y: p.y + ddy, lx: p.lx + ddx, ly: p.ly + ddy, rx: p.rx + ddx, ry: p.ry + ddy, ux: p.ux + ddx, uy: p.uy + ddy, dx: p.dx + ddx, dy: p.dy + ddy };
}

// ---- building a mesh from a path ----

/** A straight segment with handles at thirds, so its parameter runs evenly along it. */
function evenLine(c) {
  const retracted = Math.hypot(c[2] - c[0], c[3] - c[1]) < 1e-9 && Math.hypot(c[4] - c[6], c[5] - c[7]) < 1e-9;
  if (!retracted) return c;
  const dx = (c[6] - c[0]) / 3;
  const dy = (c[7] - c[1]) / 3;
  return [c[0], c[1], c[0] + dx, c[1] + dy, c[6] - dx, c[7] - dy, c[6], c[7]];
}

const revCubic = (c) => [c[6], c[7], c[4], c[5], c[2], c[3], c[0], c[1]];

/** Evaluate a chain of cubics at u in [0, 1] (equal parameter length per segment): { p, d } with d = dP/du. */
function chainAt(chain, u) {
  const k = chain.length;
  let f = u * k;
  let i = Math.min(k - 1, Math.floor(f));
  if (i < 0) i = 0;
  const t = Math.min(1, Math.max(0, f - i));
  const d = derivativeAt(chain[i], t);
  return { p: pointAt(chain[i], t), d: { x: d.x * k, y: d.y * k } };
}

/** The part of a cubic between t0 and t1. */
export function subCubic(c, t0, t1) {
  if (t0 <= 0 && t1 >= 1) return c.slice();
  let part = c;
  if (t1 < 1) part = split(part, t1)[0];
  if (t0 > 0) part = split(part, t0 / t1)[1];
  return part;
}

/**
 * Split a chain into n cubics of equal parameter length. A piece inside one
 * segment is exact; a piece spanning a joint is a cubic with the same end
 * points and end tangents.
 */
export function chainPieces(chain, n) {
  const k = chain.length;
  const out = [];
  for (let p = 0; p < n; p++) {
    const u0 = (p * k) / n;
    const u1 = ((p + 1) * k) / n;
    const s0 = Math.min(k - 1, Math.floor(u0 + 1e-9));
    const s1 = Math.min(k - 1, Math.ceil(u1 - 1e-9) - 1);
    if (s0 === s1 || s1 < s0) {
      out.push(subCubic(chain[s0], u0 - s0, Math.min(1, u1 - s0)));
      continue;
    }
    const a = chainAt(chain, u0 / k);
    const b = chainAt(chain, u1 / k);
    const span = (u1 - u0) / k / 3;
    out.push([a.p.x, a.p.y, a.p.x + a.d.x * span, a.p.y + a.d.y * span, b.p.x - b.d.x * span, b.p.y - b.d.y * span, b.p.x, b.p.y]);
  }
  return out;
}

function cornerSharpness(anchors, i) {
  const a = anchors[i];
  const n = anchors.length;
  const prev = anchors[(i - 1 + n) % n];
  const next = anchors[(i + 1) % n];
  let inx = a.x - a.ix;
  let iny = a.y - a.iy;
  if (Math.hypot(inx, iny) < 1e-9) [inx, iny] = [a.x - prev.ox, a.y - prev.oy];
  if (Math.hypot(inx, iny) < 1e-9) [inx, iny] = [a.x - prev.x, a.y - prev.y];
  let outx = a.ox - a.x;
  let outy = a.oy - a.y;
  if (Math.hypot(outx, outy) < 1e-9) [outx, outy] = [next.ix - a.x, next.iy - a.y];
  if (Math.hypot(outx, outy) < 1e-9) [outx, outy] = [next.x - a.x, next.y - a.y];
  const l = Math.hypot(inx, iny) * Math.hypot(outx, outy);
  if (!l) return 0;
  return 1 - (inx * outx + iny * outy) / l; // 0 smooth .. 2 cusp
}

/**
 * Four corner anchor indices (clockwise) splitting a closed outline into
 * the mesh's four sides: anchors spread evenly around the outline,
 * preferring sharp corners, starting nearest the top-left.
 */
export function chooseCorners(anchors) {
  const n = anchors.length;
  if (n === 4) return rotateToTopLeft(anchors, [0, 1, 2, 3]);
  const lens = [];
  let total = 0;
  for (let i = 0; i < n; i++) {
    const c = segmentPoints(anchors, i);
    const l = Math.hypot(c[2] - c[0], c[3] - c[1]) + Math.hypot(c[4] - c[2], c[5] - c[3]) + Math.hypot(c[6] - c[4], c[7] - c[5]);
    const chord = Math.hypot(c[6] - c[0], c[7] - c[1]);
    lens.push((l + chord) / 2);
    total += (l + chord) / 2;
  }
  const pos = [];
  let acc = 0;
  for (let i = 0; i < n; i++) {
    pos.push(acc / (total || 1));
    acc += lens[i];
  }
  const sharp = anchors.map((_, i) => cornerSharpness(anchors, i));
  let best = null;
  for (let a = 0; a < n; a++) {
    const pick = [a];
    let score = -sharp[a] * 0.15;
    let ok = true;
    for (let q = 1; q < 4; q++) {
      const target = (pos[a] + q / 4) % 1;
      let bi = -1;
      let bd = Infinity;
      for (let i = 0; i < n; i++) {
        const off = (i - a + n) % n;
        const prevOff = (pick[pick.length - 1] - a + n) % n;
        if (off <= prevOff) continue;
        let d = Math.abs(pos[i] - target);
        d = Math.min(d, 1 - d);
        const sc = d - sharp[i] * 0.15;
        if (sc < bd) {
          bd = sc;
          bi = i;
        }
      }
      if (bi < 0) {
        ok = false;
        break;
      }
      pick.push(bi);
      score += bd;
    }
    // Every side needs at least one segment, and the last side must close.
    if (!ok || (pick[3] - a + n) % n === 0) continue;
    if (!best || score < best.score - 1e-9) best = { score, pick };
  }
  return rotateToTopLeft(anchors, best ? best.pick : [0, 1, 2, 3]);
}

function rotateToTopLeft(anchors, pick) {
  const b = pathBounds(anchors, true);
  let k = 0;
  let bd = Infinity;
  pick.forEach((i, q) => {
    const a = anchors[i];
    const d = (a.x - b.x) / (b.w || 1) + (a.y - b.y) / (b.h || 1);
    if (d < bd - 1e-9) {
      bd = d;
      k = q;
    }
  });
  return [...pick.slice(k), ...pick.slice(0, k)];
}

/** Closed outline anchors prepared for meshing: clockwise, at least four anchors. */
export function prepareOutline(anchors) {
  let a = anchors.map((p) => ({ ...p }));
  if (signedArea(a, true) < 0) a = reverseAnchors(a);
  // Drop a duplicated closing anchor.
  while (a.length > 1 && Math.hypot(a[0].x - a[a.length - 1].x, a[0].y - a[a.length - 1].y) < 1e-6) {
    const last = a.pop();
    a[0] = { ...a[0], ix: last.ix, iy: last.iy };
  }
  while (a.length < 4) {
    let li = 0;
    let ll = -1;
    for (let i = 0; i < a.length; i++) {
      const c = segmentPoints(a, i);
      const l = Math.hypot(c[6] - c[0], c[7] - c[1]) + Math.hypot(c[2] - c[0], c[3] - c[1]);
      if (l > ll) {
        ll = l;
        li = i;
      }
    }
    a = insertAnchor(a, true, li, 0.5);
  }
  return a;
}

/** The four side chains (top, right, bottom, left) of an outline, each running left-to-right or top-to-bottom. */
export function outlineSides(anchors) {
  const a = prepareOutline(anchors);
  const n = a.length;
  const [c0, c1, c2, c3] = chooseCorners(a);
  const chain = (from, to) => {
    const out = [];
    for (let i = from; i !== to; i = (i + 1) % n) out.push(evenLine(segmentPoints(a, i)));
    return out;
  };
  return {
    top: chain(c0, c1),
    right: chain(c1, c2),
    bottom: chain(c2, c3).reverse().map(revCubic),
    left: chain(c3, c0).reverse().map(revCubic),
  };
}

/**
 * Build mesh points for an outline's sides with `rows` x `cols` patches:
 * the outline exactly where its segments allow, interior points and
 * handles from the Coons surface the sides span.
 */
export function gridFromSides(sides, rows, cols, color = '#ffffff') {
  const top = chainPieces(sides.top, cols);
  const bottom = chainPieces(sides.bottom, cols);
  const left = chainPieces(sides.left, rows);
  const right = chainPieces(sides.right, rows);
  // The whole region as one Coons surface over the side chains.
  const T = (s) => chainAt(sides.top, s);
  const Bo = (s) => chainAt(sides.bottom, s);
  const L = (t) => chainAt(sides.left, t);
  const Rt = (t) => chainAt(sides.right, t);
  const A = T(0).p;
  const B = T(1).p;
  const D = Bo(0).p;
  const C = Bo(1).p;
  const surf = (s, t) => {
    const ts = T(s);
    const bs = Bo(s);
    const lt = L(t);
    const rt = Rt(t);
    const us = 1 - s;
    const ut = 1 - t;
    const P = {
      x: ut * ts.p.x + t * bs.p.x + us * lt.p.x + s * rt.p.x - (us * ut * A.x + s * ut * B.x + us * t * D.x + s * t * C.x),
      y: ut * ts.p.y + t * bs.p.y + us * lt.p.y + s * rt.p.y - (us * ut * A.y + s * ut * B.y + us * t * D.y + s * t * C.y),
    };
    const Ss = {
      x: ut * ts.d.x + t * bs.d.x - lt.p.x + rt.p.x - (-ut * A.x + ut * B.x - t * D.x + t * C.x),
      y: ut * ts.d.y + t * bs.d.y - lt.p.y + rt.p.y - (-ut * A.y + ut * B.y - t * D.y + t * C.y),
    };
    const St = {
      x: -ts.p.x + bs.p.x + us * lt.d.x + s * rt.d.x - (-us * A.x - s * B.x + us * D.x + s * C.x),
      y: -ts.p.y + bs.p.y + us * lt.d.y + s * rt.d.y - (-us * A.y - s * B.y + us * D.y + s * C.y),
    };
    return { P, Ss, St };
  };
  const points = [];
  for (let i = 0; i <= rows; i++) {
    for (let j = 0; j <= cols; j++) {
      const s = j / cols;
      const t = i / rows;
      const { P, Ss, St } = surf(s, t);
      const hs = 1 / (3 * cols);
      const ht = 1 / (3 * rows);
      let x = P.x;
      let y = P.y;
      // Points on the outline take their exact position from the side pieces.
      if (i === 0) [x, y] = j < cols ? [top[j][0], top[j][1]] : [top[cols - 1][6], top[cols - 1][7]];
      else if (i === rows) [x, y] = j < cols ? [bottom[j][0], bottom[j][1]] : [bottom[cols - 1][6], bottom[cols - 1][7]];
      else if (j === 0) [x, y] = [left[i][0], left[i][1]];
      else if (j === cols) [x, y] = [right[i][0], right[i][1]];
      const p = { x, y, c: color, a: 1, lx: x - Ss.x * hs, ly: y - Ss.y * hs, rx: x + Ss.x * hs, ry: y + Ss.y * hs, ux: x - St.x * ht, uy: y - St.y * ht, dx: x + St.x * ht, dy: y + St.y * ht };
      // Handles along the outline follow its pieces.
      if (i === 0 || i === rows) {
        const side = i === 0 ? top : bottom;
        if (j > 0) [p.lx, p.ly] = [side[j - 1][4], side[j - 1][5]];
        if (j < cols) [p.rx, p.ry] = [side[j][2], side[j][3]];
      }
      if (j === 0 || j === cols) {
        const side = j === 0 ? left : right;
        if (i > 0) [p.ux, p.uy] = [side[i - 1][4], side[i - 1][5]];
        if (i < rows) [p.dx, p.dy] = [side[i][2], side[i][3]];
      }
      // Handles pointing out of the grid stay on their point.
      if (j === 0) [p.lx, p.ly] = [x, y];
      if (j === cols) [p.rx, p.ry] = [x, y];
      if (i === 0) [p.ux, p.uy] = [x, y];
      if (i === rows) [p.dx, p.dy] = [x, y];
      points.push(p);
    }
  }
  return points;
}

/** The natural patch counts for an outline: one patch per side segment (the longer of opposite sides). */
export function naturalGrid(sides) {
  return { rows: Math.max(sides.left.length, sides.right.length), cols: Math.max(sides.top.length, sides.bottom.length) };
}

/**
 * Mesh points for a closed path. `rows`/`cols` default to the outline's
 * natural grid, which keeps it exact. Appearance: 'flat', 'center' (a
 * highlight toward the middle) or 'edge' (a highlight at the outline),
 * with `highlight` 0..1 toward white.
 */
export function meshFromOutline(anchors, { rows, cols, color = '#ffffff', appearance = 'flat', highlight = 1, opacity = 1 } = {}) {
  const sides = outlineSides(anchors);
  const nat = naturalGrid(sides);
  const R = Math.max(1, Math.round(rows || nat.rows));
  const C = Math.max(1, Math.round(cols || nat.cols));
  const points = gridFromSides(sides, R, C, color);
  const hi = mixHex(color, '#ffffff', Math.max(0, Math.min(1, highlight)));
  for (let i = 0; i <= R; i++) {
    for (let j = 0; j <= C; j++) {
      const p = points[i * (C + 1) + j];
      const edge = i === 0 || j === 0 || i === R || j === C;
      if (appearance === 'center' && !edge) p.c = hi;
      if (appearance === 'edge' && edge) p.c = hi;
      p.a = opacity;
    }
  }
  return { rows: R, cols: C, points };
}

function mixHex(a, b, t) {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  return rgbToHex({ r: A.r + (B.r - A.r) * t, g: A.g + (B.g - A.g) * t, b: A.b + (B.b - A.b) * t });
}

// ---- editing ----

/** Iso-curve s = const of a patch as cubic control points (exact: Coons iso-curves are cubics). */
export function isoS(p, s) {
  const { top, bottom, left, right, A, B, C, D } = p;
  const T = pointAt(top, s);
  const Bo = pointAt(bottom, s);
  const e0 = { x: T.x - (1 - s) * A.x - s * B.x, y: T.y - (1 - s) * A.y - s * B.y };
  const e1 = { x: Bo.x - (1 - s) * D.x - s * C.x, y: Bo.y - (1 - s) * D.y - s * C.y };
  const out = [];
  for (let k = 0; k < 4; k++) {
    const w = k / 3;
    out.push((1 - s) * left[2 * k] + s * right[2 * k] + (1 - w) * e0.x + w * e1.x);
    out.push((1 - s) * left[2 * k + 1] + s * right[2 * k + 1] + (1 - w) * e0.y + w * e1.y);
  }
  return out;
}

/** Iso-curve t = const of a patch. */
export function isoT(p, t) {
  const { top, bottom, left, right, A, B, C, D } = p;
  const L = pointAt(left, t);
  const R = pointAt(right, t);
  const f0 = { x: L.x - (1 - t) * A.x - t * D.x, y: L.y - (1 - t) * A.y - t * D.y };
  const f1 = { x: R.x - (1 - t) * B.x - t * C.x, y: R.y - (1 - t) * B.y - t * C.y };
  const out = [];
  for (let k = 0; k < 4; k++) {
    const w = k / 3;
    out.push((1 - t) * top[2 * k] + t * bottom[2 * k] + (1 - w) * f0.x + w * f1.x);
    out.push((1 - t) * top[2 * k + 1] + t * bottom[2 * k + 1] + (1 - w) * f0.y + w * f1.y);
  }
  return out;
}

/**
 * Add a column line through column j at parameter s (0 < s < 1). The
 * surface and colors stay exactly the same. Returns { rows, cols, points }.
 */
export function insertColumn(m, j, s) {
  const { rows: R, cols: C } = m;
  const pts = m.points.map((p) => ({ ...p }));
  const at = (i, jj) => pts[i * (C + 1) + jj];
  const added = [];
  for (let i = 0; i <= R; i++) {
    const [l, r] = split(hEdge(m, i, j), s);
    const P = at(i, j);
    const Q = at(i, j + 1);
    P.rx = l[2];
    P.ry = l[3];
    Q.lx = r[4];
    Q.ly = r[5];
    const col = blendPoints(P, Q, s);
    added.push({ x: l[6], y: l[7], c: col.c, a: col.a, lx: l[4], ly: l[5], rx: r[2], ry: r[3], ux: l[6], uy: l[7], dx: l[6], dy: l[7] });
  }
  for (let i = 0; i < R; i++) {
    const iso = isoS(patchOf(m, i, j), s);
    added[i].dx = iso[2];
    added[i].dy = iso[3];
    added[i + 1].ux = iso[4];
    added[i + 1].uy = iso[5];
  }
  const out = [];
  for (let i = 0; i <= R; i++) {
    for (let jj = 0; jj <= C; jj++) {
      out.push(at(i, jj));
      if (jj === j) out.push(added[i]);
    }
  }
  return { rows: R, cols: C + 1, points: out };
}

/** Add a row line through row i at parameter t (0 < t < 1), keeping the surface. */
export function insertRow(m, i, t) {
  const { rows: R, cols: C } = m;
  const pts = m.points.map((p) => ({ ...p }));
  const at = (ii, j) => pts[ii * (C + 1) + j];
  const added = [];
  for (let j = 0; j <= C; j++) {
    const [u, d] = split(vEdge(m, i, j), t);
    const P = at(i, j);
    const Q = at(i + 1, j);
    P.dx = u[2];
    P.dy = u[3];
    Q.ux = d[4];
    Q.uy = d[5];
    const col = blendPoints(P, Q, t);
    added.push({ x: u[6], y: u[7], c: col.c, a: col.a, ux: u[4], uy: u[5], dx: d[2], dy: d[3], lx: u[6], ly: u[7], rx: u[6], ry: u[7] });
  }
  for (let j = 0; j < C; j++) {
    const iso = isoT(patchOf(m, i, j), t);
    added[j].rx = iso[2];
    added[j].ry = iso[3];
    added[j + 1].lx = iso[4];
    added[j + 1].ly = iso[5];
  }
  const out = [];
  for (let ii = 0; ii <= R; ii++) {
    for (let j = 0; j <= C; j++) out.push(at(ii, j));
    if (ii === i) out.push(...added);
  }
  return { rows: R + 1, cols: C, points: out };
}

/** The split ratio of a point between its two handles along a line (exact for points made by a split). */
function splitRatio(p, h1x, h1y, h2x, h2y) {
  const a = Math.hypot(p.x - h1x, p.y - h1y);
  const b = Math.hypot(h2x - p.x, h2y - p.y);
  return a + b > 1e-9 ? a / (a + b) : 0.5;
}

/** Remove interior column line j (0 < j < cols), merging the patches beside it. */
export function removeColumn(m, j) {
  const { rows: R, cols: C } = m;
  if (j <= 0 || j >= C) return m;
  const pts = m.points.map((p) => ({ ...p }));
  const at = (i, jj) => pts[i * (C + 1) + jj];
  for (let i = 0; i <= R; i++) {
    const P = at(i, j - 1);
    const M = at(i, j);
    const Q = at(i, j + 1);
    const tau = Math.min(0.98, Math.max(0.02, splitRatio(M, M.lx, M.ly, M.rx, M.ry)));
    P.rx = P.x + (P.rx - P.x) / tau;
    P.ry = P.y + (P.ry - P.y) / tau;
    Q.lx = Q.x + (Q.lx - Q.x) / (1 - tau);
    Q.ly = Q.y + (Q.ly - Q.y) / (1 - tau);
  }
  const out = [];
  for (let i = 0; i <= R; i++) for (let jj = 0; jj <= C; jj++) if (jj !== j) out.push(at(i, jj));
  return { rows: R, cols: C - 1, points: out };
}

/** Remove interior row line i (0 < i < rows). */
export function removeRow(m, i) {
  const { rows: R, cols: C } = m;
  if (i <= 0 || i >= R) return m;
  const pts = m.points.map((p) => ({ ...p }));
  const at = (ii, j) => pts[ii * (C + 1) + j];
  for (let j = 0; j <= C; j++) {
    const P = at(i - 1, j);
    const M = at(i, j);
    const Q = at(i + 1, j);
    const tau = Math.min(0.98, Math.max(0.02, splitRatio(M, M.ux, M.uy, M.dx, M.dy)));
    P.dx = P.x + (P.dx - P.x) / tau;
    P.dy = P.y + (P.dy - P.y) / tau;
    Q.ux = Q.x + (Q.ux - Q.x) / (1 - tau);
    Q.uy = Q.y + (Q.uy - Q.y) / (1 - tau);
  }
  const out = [];
  for (let ii = 0; ii <= R; ii++) if (ii !== i) for (let j = 0; j <= C; j++) out.push(at(ii, j));
  return { rows: R - 1, cols: C, points: out };
}

/**
 * Slide point k along the line through it (axis 'h': its row line, 'v':
 * its column line) so it sits at parameter u (0..1) between its two
 * neighbors on that line; the line keeps its shape.
 */
export function slidePoint(m, k, axis, u) {
  const [i, j] = rowCol(m, k);
  const pts = m.points.map((p) => ({ ...p }));
  const C = m.cols;
  const at = (ii, jj) => pts[ii * (C + 1) + jj];
  const M = at(i, j);
  let P;
  let Q;
  let joined;
  if (axis === 'h') {
    if (j <= 0 || j >= C) return m;
    P = at(i, j - 1);
    Q = at(i, j + 1);
    joined = mergeCubics(hEdge(m, i, j - 1), hEdge(m, i, j), splitRatio(M, M.lx, M.ly, M.rx, M.ry));
  } else {
    if (i <= 0 || i >= m.rows) return m;
    P = at(i - 1, j);
    Q = at(i + 1, j);
    joined = mergeCubics(vEdge(m, i - 1, j), vEdge(m, i, j), splitRatio(M, M.ux, M.uy, M.dx, M.dy));
  }
  const uu = Math.min(0.98, Math.max(0.02, u));
  const [l, r] = split(joined, uu);
  const moved = movePoint(M, l[6] - M.x, l[7] - M.y);
  if (axis === 'h') {
    P.rx = l[2];
    P.ry = l[3];
    moved.lx = l[4];
    moved.ly = l[5];
    moved.rx = r[2];
    moved.ry = r[3];
    Q.lx = r[4];
    Q.ly = r[5];
  } else {
    P.dx = l[2];
    P.dy = l[3];
    moved.ux = l[4];
    moved.uy = l[5];
    moved.dx = r[2];
    moved.dy = r[3];
    Q.ux = r[4];
    Q.uy = r[5];
  }
  pts[k] = moved;
  return { rows: m.rows, cols: m.cols, points: pts };
}

/** One cubic for two consecutive cubics that came from splitting at tau. */
export function mergeCubics(a, b, tau) {
  const t = Math.min(0.98, Math.max(0.02, tau));
  return [a[0], a[1], a[0] + (a[2] - a[0]) / t, a[1] + (a[3] - a[1]) / t, b[6] + (b[4] - b[6]) / (1 - t), b[7] + (b[5] - b[7]) / (1 - t), b[6], b[7]];
}

/** The line through point k nearest a document point and the slide parameter there: { axis, u } or null. */
export function slideTarget(m, k, x, y) {
  const [i, j] = rowCol(m, k);
  const M = m.points[k];
  let best = null;
  if (j > 0 && j < m.cols) {
    const c = mergeCubics(hEdge(m, i, j - 1), hEdge(m, i, j), splitRatio(M, M.lx, M.ly, M.rx, M.ry));
    const r = nearestOnCubic(c, x, y);
    best = { axis: 'h', u: r.t, d: r.d };
  }
  if (i > 0 && i < m.rows) {
    const c = mergeCubics(vEdge(m, i - 1, j), vEdge(m, i, j), splitRatio(M, M.ux, M.uy, M.dx, M.dy));
    const r = nearestOnCubic(c, x, y);
    if (!best || r.d < best.d) best = { axis: 'v', u: r.t, d: r.d };
  }
  return best;
}

// ---- hit testing ----

/** Patch and parameters under a document point: { i, j, s, t } or null. */
export function locate(m, x, y) {
  for (let i = m.rows - 1; i >= 0; i--) {
    for (let j = m.cols - 1; j >= 0; j--) {
      const p = patchOf(m, i, j);
      const b = [p.top, p.bottom, p.left, p.right].map(cubicBounds).reduce((acc, r) => {
        if (!acc) return { ...r };
        const x0 = Math.min(acc.x, r.x);
        const y0 = Math.min(acc.y, r.y);
        return { x: x0, y: y0, w: Math.max(acc.x + acc.w, r.x + r.w) - x0, h: Math.max(acc.y + acc.h, r.y + r.h) - y0 };
      }, null);
      if (x < b.x - 1e-6 || x > b.x + b.w + 1e-6 || y < b.y - 1e-6 || y > b.y + b.h + 1e-6) continue;
      const r = invertPatch(p, x, y);
      if (r) return { i, j, s: r.s, t: r.t };
    }
  }
  return null;
}

/** (s, t) of a patch point nearest (x, y), when it lies inside the patch. */
export function invertPatch(p, x, y, tol = 1e-3) {
  let s = 0.5;
  let t = 0.5;
  let bd = Infinity;
  const N = 8;
  for (let a = 0; a <= N; a++) {
    for (let b = 0; b <= N; b++) {
      const q = evalPatch(p, a / N, b / N);
      const d = (q.x - x) ** 2 + (q.y - y) ** 2;
      if (d < bd) {
        bd = d;
        s = a / N;
        t = b / N;
      }
    }
  }
  for (let k = 0; k < 24; k++) {
    const q = evalPatch(p, s, t);
    const fx = q.x - x;
    const fy = q.y - y;
    if (Math.hypot(fx, fy) < 1e-7) break;
    const { su, tv } = patchDerivatives(p, s, t);
    const det = su.x * tv.y - tv.x * su.y;
    if (Math.abs(det) < 1e-12) break;
    const ds = (fx * tv.y - tv.x * fy) / det;
    const dt = (su.x * fy - fx * su.y) / det;
    s = Math.min(1.05, Math.max(-0.05, s - ds));
    t = Math.min(1.05, Math.max(-0.05, t - dt));
  }
  const q = evalPatch(p, s, t);
  const scale = Math.max(1, Math.hypot(p.B.x - p.A.x, p.B.y - p.A.y), Math.hypot(p.D.x - p.A.x, p.D.y - p.A.y));
  if (Math.hypot(q.x - x, q.y - y) > tol * scale) return null;
  if (s < -1e-6 || s > 1 + 1e-6 || t < -1e-6 || t > 1 + 1e-6) return null;
  return { s: Math.min(1, Math.max(0, s)), t: Math.min(1, Math.max(0, t)) };
}

/** Nearest mesh line within `tol` of a document point: { kind, i, j, t, d } or null. */
export function nearestEdge(m, x, y, tol) {
  let best = null;
  for (const e of meshEdges(m)) {
    const b = cubicBounds(e.c);
    if (x < b.x - tol || x > b.x + b.w + tol || y < b.y - tol || y > b.y + b.h + tol) continue;
    const r = nearestOnCubic(e.c, x, y);
    if (r.d <= tol && (!best || r.d < best.d)) best = { kind: e.kind, i: e.i, j: e.j, t: r.t, d: r.d, x: r.x, y: r.y };
  }
  return best;
}

/** Nearest mesh point within `tol` (in the units `toScreen` returns): its index or -1. */
export function nearestPoint(m, x, y, tol, toScreen = null) {
  let best = -1;
  let bd = tol;
  m.points.forEach((p, k) => {
    const s = toScreen ? toScreen(p.x, p.y) : p;
    const d = Math.hypot(s.x - x, s.y - y);
    if (d <= bd) {
      bd = d;
      best = k;
    }
  });
  return best;
}

/** The handles of a point that shape a mesh line ('l', 'r', 'u', 'd'). */
export function liveHandles(m, k) {
  const [i, j] = rowCol(m, k);
  const out = [];
  if (j > 0) out.push('l');
  if (j < m.cols) out.push('r');
  if (i > 0) out.push('u');
  if (i < m.rows) out.push('d');
  return out;
}

/** Nearest handle of the given points: { k, dir } or null. */
export function nearestHandle(m, ks, x, y, tol, toScreen = null) {
  let best = null;
  let bd = tol;
  for (const k of ks) {
    const p = m.points[k];
    if (!p) continue;
    for (const dir of liveHandles(m, k)) {
      const hx = p[`${dir}x`];
      const hy = p[`${dir}y`];
      if (Math.hypot(hx - p.x, hy - p.y) < 1e-9) continue;
      const s = toScreen ? toScreen(hx, hy) : { x: hx, y: hy };
      const d = Math.hypot(s.x - x, s.y - y);
      if (d <= bd) {
        bd = d;
        best = { k, dir };
      }
    }
  }
  return best;
}

/** Indices of the four corner points of patch (i, j). */
export function patchCorners(m, i, j) {
  return [idx(m, i, j), idx(m, i, j + 1), idx(m, i + 1, j + 1), idx(m, i + 1, j)];
}

/** Mesh with a document point turned into a mesh point (adding lines through it): { mesh, k } or null. */
export function addPointAt(m, x, y, tol = 0) {
  const e = tol > 0 ? nearestEdge(m, x, y, tol) : null;
  if (e) {
    // On a line: one new line across it.
    const t = Math.min(0.999, Math.max(0.001, e.t));
    if (e.kind === 'h') {
      const out = insertColumn(m, e.j, t);
      return { mesh: out, k: e.i * (out.cols + 1) + e.j + 1 };
    }
    const out = insertRow(m, e.i, t);
    return { mesh: out, k: (e.i + 1) * (out.cols + 1) + e.j };
  }
  const hit = locate(m, x, y);
  if (!hit) return null;
  const s = Math.min(0.999, Math.max(0.001, hit.s));
  const t = Math.min(0.999, Math.max(0.001, hit.t));
  const a = insertColumn(m, hit.j, s);
  const b = insertRow(a, hit.i, t);
  return { mesh: b, k: (hit.i + 1) * (b.cols + 1) + hit.j + 1 };
}

/** Apply a matrix to a document point. */
export function applyPoint(mat, x, y) {
  return apply(mat, x, y);
}
