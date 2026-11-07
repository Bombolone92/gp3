// As-rigid-as-possible deformation of a triangle mesh driven by pins, solved
// with the local/global alternation: the local step fits each triangle's best
// rotation (with some or all of its scale, per mode) to its current shape,
// the global step solves one sparse linear system for the vertex positions
// that best match those per-triangle targets while holding the pins.
//
// A pin holds a small disc of the mesh (the vertices near it) rigidly rather
// than a single point, which avoids the sharp twist a point constraint makes
// in an elastic sheet. The disc turns with the surrounding area, or by a
// fixed angle.
//
// The system matrix only depends on the mesh and on where the pins sit, so
// it is factored once when pins are added or removed and every iteration
// costs two triangular solves. Iterations continue from the previous shape,
// so a drag converges as it goes; `settle` reaches the same shape from rest.
import { EnvelopeCholesky, SymmetricBuilder } from './sparse';
import type { TriMesh } from './pin-mesh';

/** How much triangles may change size: none, some, or freely (similarity). */
export type ArapMode = 'rigid' | 'normal' | 'distort';
export const ARAP_MODES: [ArapMode, string][] = [
  ['rigid', 'Rigid'],
  ['normal', 'Normal'],
  ['distort', 'Distort'],
];
export type ArapPin = {
  // Triangle and barycentric weights of the pinned point in the rest mesh.
  tri: number;
  bary: readonly [number, number, number];
  // Where the pinned point should be.
  x: number;
  y: number;
  // Fixed rotation (radians) of the area around the pin; automatic when undefined.
  angle?: number;
};

// Pins are soft constraints, but stiff enough to hold to a hundredth of a pixel.
const PIN_WEIGHT = 1e4;
// Parts of the mesh with no pin on them stay where they are.
const ANCHOR = 1e-3;
// Radius of a pin's rigid disc, in mesh cells.
const HANDLE = 0.75;
// How much of a triangle's fitted scale the local step keeps, per mode, and
// the most it may grow or shrink.
const SCALE_FREEDOM: Record<ArapMode, number> = { rigid: 0, normal: 0.5, distort: 0.85 };
const SCALE_LIMIT = 3;

// A pin's disc (vertices with rest offsets from the pin) and the ring of
// triangles around it whose rotation the disc follows.
type Handle = { v: Int32Array; rx: Float64Array; ry: Float64Array; cx: number; cy: number; ring: Int32Array };
const pinKey = (p: ArapPin) => `${p.tri}:${p.bary[0]},${p.bary[1]}`;

export class ArapSolver {
  readonly n: number;
  readonly m: number;
  readonly tris: Uint32Array;
  readonly rest: Float64Array;
  /** Current vertex positions (interleaved x, y). */
  readonly pos: Float64Array;
  /** Fitted rotation of each triangle after the last local step (radians). */
  readonly angles: Float64Array;
  mode: ArapMode = 'normal';
  private grad: Float64Array; // 3 x 2 per triangle: rest gradient operator
  private area: Float64Array;
  private laplacian: SymmetricBuilder;
  private factor?: EnvelopeCholesky;
  private factorKey = '';
  private pins: ArapPin[] = [];
  private handles: Handle[] = [];
  // Current rotation of each pin's disc.
  private pinAngles: number[] = [];
  // Per triangle: index of the fixed-angle pin that sets its rotation, or -1.
  private fixedBy: Int32Array;
  private spacing: number;
  private bx: Float64Array;
  private by: Float64Array;
  private sx: Float64Array;
  private sy: Float64Array;
  // Connected part of the mesh each vertex belongs to, and the pull toward
  // rest for the vertices of parts without pins.
  private part: Int32Array;
  private anchor: Float64Array;

  constructor(mesh: TriMesh) {
    this.rest = mesh.rest;
    this.tris = mesh.tris;
    this.spacing = mesh.spacing;
    const n = (this.n = mesh.rest.length / 2);
    const m = (this.m = mesh.tris.length / 3);
    this.pos = new Float64Array(mesh.rest);
    this.angles = new Float64Array(m);
    this.grad = new Float64Array(m * 6);
    this.area = new Float64Array(m);
    this.fixedBy = new Int32Array(m).fill(-1);
    this.bx = new Float64Array(n);
    this.by = new Float64Array(n);
    this.sx = new Float64Array(n);
    this.sy = new Float64Array(n);
    const L = (this.laplacian = new SymmetricBuilder(n));
    const P = mesh.rest,
      T = mesh.tris;
    const parent = Int32Array.from({ length: n }, (_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    for (let k = 0; k < T.length; k += 3) {
      parent[find(T[k])] = find(T[k + 1]);
      parent[find(T[k + 1])] = find(T[k + 2]);
    }
    this.part = Int32Array.from({ length: n }, (_, i) => find(i));
    this.anchor = new Float64Array(n).fill(ANCHOR);
    for (let t = 0; t < m; t++) {
      const a = T[t * 3],
        b = T[t * 3 + 1],
        c = T[t * 3 + 2];
      const e1x = P[b * 2] - P[a * 2],
        e1y = P[b * 2 + 1] - P[a * 2 + 1],
        e2x = P[c * 2] - P[a * 2],
        e2y = P[c * 2 + 1] - P[a * 2 + 1];
      const det = e1x * e2y - e2x * e1y;
      if (Math.abs(det) < 1e-12) continue;
      // Rows of the inverse edge matrix; the gradient of a linear function
      // with vertex values (f0, f1, f2) is f0·G0 + f1·G1 + f2·G2.
      const i00 = e2y / det,
        i01 = -e2x / det,
        i10 = -e1y / det,
        i11 = e1x / det;
      const G = this.grad,
        o = t * 6;
      G[o] = -i00 - i10;
      G[o + 1] = -i01 - i11;
      G[o + 2] = i00;
      G[o + 3] = i01;
      G[o + 4] = i10;
      G[o + 5] = i11;
      const A = (this.area[t] = Math.abs(det) / 2);
      const v = [a, b, c];
      for (let i = 0; i < 3; i++)
        for (let j = 0; j <= i; j++) L.add(v[i], v[j], A * (G[o + i * 2] * G[o + j * 2] + G[o + i * 2 + 1] * G[o + j * 2 + 1]));
    }
  }

  /** Replace the pins. The matrix is refactored only when pins were added,
   * removed or relocated in the rest mesh; moving targets or changing
   * angles is free. */
  setPins(pins: ArapPin[]) {
    const old = this.pins;
    this.pins = pins;
    const key = pins.map(pinKey).join('|');
    if (key !== this.factorKey) {
      const kept = new Map(old.map((p, i) => [pinKey(p), this.pinAngles[i]] as const));
      this.factorKey = key;
      this.factor = undefined;
      this.handles = pins.map((p) => this.handle(p));
      this.pinAngles = pins.map((p) => kept.get(pinKey(p)) ?? this.angles[p.tri] ?? 0);
      const pinned = new Set(pins.map((p) => this.part[this.tris[p.tri * 3]]));
      for (let i = 0; i < this.n; i++) this.anchor[i] = pinned.has(this.part[i]) ? 0 : ANCHOR;
    }
    this.assignFixed();
  }
  /** The disc of vertices a pin holds: its triangle's corners and every
   * vertex within the handle radius, as offsets from the pinned point. */
  private handle(p: ArapPin): Handle {
    const c = this.restPoint(p);
    const r2 = (HANDLE * this.spacing) ** 2;
    const list = new Set<number>([this.tris[p.tri * 3], this.tris[p.tri * 3 + 1], this.tris[p.tri * 3 + 2]]);
    for (let i = 0; i < this.n; i++) if ((this.rest[i * 2] - c.x) ** 2 + (this.rest[i * 2 + 1] - c.y) ** 2 <= r2) list.add(i);
    const v = Int32Array.from(list);
    const ring: number[] = [];
    const R2 = ((HANDLE + 1.5) * this.spacing) ** 2,
      P = this.rest,
      T = this.tris;
    for (let t = 0; t < this.m; t++) {
      const a = T[t * 3],
        b = T[t * 3 + 1],
        d = T[t * 3 + 2];
      if (list.has(a) && list.has(b) && list.has(d)) continue;
      const cx = (P[a * 2] + P[b * 2] + P[d * 2]) / 3,
        cy = (P[a * 2 + 1] + P[b * 2 + 1] + P[d * 2 + 1]) / 3;
      if ((cx - c.x) ** 2 + (cy - c.y) ** 2 <= R2) ring.push(t);
    }
    return { v, rx: Float64Array.from(v, (i) => this.rest[i * 2] - c.x), ry: Float64Array.from(v, (i) => this.rest[i * 2 + 1] - c.y), cx: c.x, cy: c.y, ring: Int32Array.from(ring) };
  }
  /** Triangles whose rest centroid is near a fixed-angle pin follow its angle. */
  private assignFixed() {
    const pins = this.pins;
    this.fixedBy.fill(-1);
    const fixed = pins.map((p, i) => (p.angle === undefined ? -1 : i)).filter((i) => i >= 0);
    if (!fixed.length) return;
    const r2 = (this.spacing * 1.6) ** 2;
    const best = new Float64Array(this.m).fill(Infinity);
    const P = this.rest,
      T = this.tris;
    for (const i of fixed) {
      const p = pins[i],
        h = this.handles[i];
      for (let t = 0; t < this.m; t++) {
        const a = T[t * 3],
          b = T[t * 3 + 1],
          d = T[t * 3 + 2];
        const cx = (P[a * 2] + P[b * 2] + P[d * 2]) / 3,
          cy = (P[a * 2 + 1] + P[b * 2 + 1] + P[d * 2 + 1]) / 3;
        const dist = (cx - h.cx) ** 2 + (cy - h.cy) ** 2;
        if ((t === p.tri || dist <= r2) && dist < best[t]) {
          best[t] = dist;
          this.fixedBy[t] = i;
        }
      }
    }
  }
  /** Rest-space position of a pin. */
  restPoint(p: Pick<ArapPin, 'tri' | 'bary'>) {
    return point(this.rest, this.tris, p.tri, p.bary);
  }
  /** Current position of a pin's point. */
  currentPoint(p: Pick<ArapPin, 'tri' | 'bary'>) {
    return point(this.pos, this.tris, p.tri, p.bary);
  }
  /** Current rotation of the area around a pin (radians). */
  pinAngle(p: Pick<ArapPin, 'tri' | 'bary' | 'angle'>) {
    if (p.angle !== undefined) return p.angle;
    const key = pinKey(p as ArapPin);
    const k = this.pins.findIndex((q) => pinKey(q) === key);
    return k >= 0 ? this.pinAngles[k] : this.angles[p.tri];
  }

  private ensureFactor() {
    if (this.factor) return this.factor;
    const n = this.n;
    const K = new SymmetricBuilder(n);
    for (let i = 0; i < n; i++) {
      for (const [j, v] of this.laplacian.row(i)) K.add(i, j, v);
      if (this.anchor[i]) K.add(i, i, this.anchor[i]);
    }
    for (const h of this.handles) for (const v of h.v) K.add(v, v, PIN_WEIGHT);
    return (this.factor = new EnvelopeCholesky(K));
  }

  /** Run `count` local/global iterations from the current positions. */
  iterate(count = 1) {
    const factor = this.ensureFactor();
    const { n, m, tris: T, grad: G, area, pos, bx, by, angles, fixedBy, pins, handles } = this;
    for (let it = 0; it < count; it++) {
      for (let i = 0; i < n; i++) {
        bx[i] = this.anchor[i] * this.rest[i * 2];
        by[i] = this.anchor[i] * this.rest[i * 2 + 1];
      }
      for (let t = 0; t < m; t++) {
        const A = area[t];
        if (!A) continue;
        const o = t * 6,
          a = T[t * 3],
          b = T[t * 3 + 1],
          c = T[t * 3 + 2];
        // Deformation gradient J of the triangle.
        const xa = pos[a * 2],
          ya = pos[a * 2 + 1],
          xb = pos[b * 2],
          yb = pos[b * 2 + 1],
          xc = pos[c * 2],
          yc = pos[c * 2 + 1];
        const jxx = xa * G[o] + xb * G[o + 2] + xc * G[o + 4],
          jxy = xa * G[o + 1] + xb * G[o + 3] + xc * G[o + 5],
          jyx = ya * G[o] + yb * G[o + 2] + yc * G[o + 4],
          jyy = ya * G[o + 1] + yb * G[o + 3] + yc * G[o + 5];
        // Closest rotation (and similarity scale) to J.
        const p = (jxx + jyy) / 2,
          q = (jyx - jxy) / 2;
        const fit = Math.hypot(p, q);
        const fixed = fixedBy[t];
        const theta = fixed >= 0 ? pins[fixed].angle! : fit > 1e-12 ? Math.atan2(q, p) : angles[t];
        angles[t] = theta;
        const s = fixed >= 0 || this.mode === 'rigid' ? 1 : Math.min(SCALE_LIMIT, Math.max(1 / SCALE_LIMIT, fit)) ** SCALE_FREEDOM[this.mode];
        const cs = Math.cos(theta) * s,
          sn = Math.sin(theta) * s;
        // Target gradient [[cs, -sn], [sn, cs]] pushed back onto the vertices.
        bx[a] += A * (cs * G[o] - sn * G[o + 1]);
        bx[b] += A * (cs * G[o + 2] - sn * G[o + 3]);
        bx[c] += A * (cs * G[o + 4] - sn * G[o + 5]);
        by[a] += A * (sn * G[o] + cs * G[o + 1]);
        by[b] += A * (sn * G[o + 2] + cs * G[o + 3]);
        by[c] += A * (sn * G[o + 4] + cs * G[o + 5]);
      }
      for (let k = 0; k < pins.length; k++) {
        const pin = pins[k],
          h = handles[k];
        let theta = pin.angle;
        if (theta === undefined) {
          // The disc turns like the ring of mesh around it (mean of the
          // ring's fitted rotations, unwrapped around the current angle).
          const prev = this.pinAngles[k];
          let c = 0,
            sn = 0;
          for (const t of h.ring) {
            c += area[t] * Math.cos(angles[t] - prev);
            sn += area[t] * Math.sin(angles[t] - prev);
          }
          theta = c || sn ? prev + Math.atan2(sn, c) : prev;
        }
        this.pinAngles[k] = theta;
        const cs = Math.cos(theta),
          sn = Math.sin(theta);
        for (let j = 0; j < h.v.length; j++) {
          const v = h.v[j];
          bx[v] += PIN_WEIGHT * (pin.x + cs * h.rx[j] - sn * h.ry[j]);
          by[v] += PIN_WEIGHT * (pin.y + sn * h.rx[j] + cs * h.ry[j]);
        }
      }
      factor.solve(bx, this.sx);
      factor.solve(by, this.sy);
      for (let i = 0; i < n; i++) {
        pos[i * 2] = this.sx[i];
        pos[i * 2 + 1] = this.sy[i];
      }
    }
  }
  /** Iterate for up to `budgetMs` milliseconds (at least `min` iterations,
   * at most `max`). Returns the number of iterations run. */
  relax(budgetMs: number, min = 1, max = 400) {
    const start = performance.now();
    let done = 0;
    while (done < max && (done < min || performance.now() - start < budgetMs)) {
      this.iterate(1);
      done++;
    }
    return done;
  }
  /** Reach the shape for `pins` from rest by moving them out in steps, the
   * way a drag would, then iterating until settled. The steps follow the
   * pins' overall turn and scale, so rotations do not pass through a
   * squashed in-between shape. */
  settle(pins: ArapPin[], steps = 10, perStep = 30, final = 200) {
    this.pos.set(this.rest);
    this.angles.fill(0);
    this.pins = [];
    this.pinAngles = [];
    this.factorKey = '\0';
    if (pins.length) {
      const from = pins.map((p) => this.restPoint(p));
      const motion = similarity(from, pins);
      for (let k = 1; k <= steps; k++) {
        const t = k / steps;
        const a = motion.angle * t,
          sc = motion.scale ** t;
        const cs = Math.cos(a) * sc,
          sn = Math.sin(a) * sc;
        const cx = motion.from.x + (motion.to.x - motion.from.x) * t,
          cy = motion.from.y + (motion.to.y - motion.from.y) * t;
        this.setPins(
          pins.map((p, i) => {
            const r = from[i],
              dx = r.x - motion.from.x,
              dy = r.y - motion.from.y;
            // Overall motion so far, plus the pin's own share of the rest.
            const res = motion.residual[i];
            return { ...p, x: cx + cs * dx - sn * dy + res.x * t, y: cy + sn * dx + cs * dy + res.y * t, angle: p.angle === undefined ? undefined : p.angle * t };
          }),
        );
        this.iterate(perStep);
      }
    }
    this.setPins(pins);
    if (pins.length) this.iterate(final);
  }
}

/** Least-squares similarity taking `from` onto `to` (about their centroids),
 * and what is left for each point. */
function similarity(from: { x: number; y: number }[], to: { x: number; y: number }[]) {
  const n = from.length;
  const f = { x: from.reduce((s, p) => s + p.x, 0) / n, y: from.reduce((s, p) => s + p.y, 0) / n };
  const g = { x: to.reduce((s, p) => s + p.x, 0) / n, y: to.reduce((s, p) => s + p.y, 0) / n };
  let dot = 0,
    cross = 0,
    norm = 0;
  for (let i = 0; i < n; i++) {
    const ax = from[i].x - f.x,
      ay = from[i].y - f.y,
      bx = to[i].x - g.x,
      by = to[i].y - g.y;
    dot += ax * bx + ay * by;
    cross += ax * by - ay * bx;
    norm += ax * ax + ay * ay;
  }
  const angle = n > 1 && norm > 1e-12 ? Math.atan2(cross, dot) : 0;
  const scale = n > 1 && norm > 1e-12 ? Math.max(1e-3, Math.hypot(dot, cross) / norm) : 1;
  const cs = Math.cos(angle) * scale,
    sn = Math.sin(angle) * scale;
  const residual = from.map((p, i) => {
    const dx = p.x - f.x,
      dy = p.y - f.y;
    return { x: to[i].x - (g.x + cs * dx - sn * dy), y: to[i].y - (g.y + sn * dx + cs * dy) };
  });
  return { from: f, to: g, angle, scale, residual };
}

function point(pos: Float64Array, T: Uint32Array, tri: number, bary: readonly number[]) {
  const a = T[tri * 3],
    b = T[tri * 3 + 1],
    c = T[tri * 3 + 2];
  return {
    x: bary[0] * pos[a * 2] + bary[1] * pos[b * 2] + bary[2] * pos[c * 2],
    y: bary[0] * pos[a * 2 + 1] + bary[1] * pos[b * 2 + 1] + bary[2] * pos[c * 2 + 1],
  };
}

/** Drawing order of triangles for overlapping folds: each triangle takes the
 * depth of the nearest pin in the rest mesh and deeper (higher) values draw
 * later, on top. Ties keep mesh order. */
export function triangleOrder(mesh: Pick<TriMesh, 'rest' | 'tris'>, pins: { x: number; y: number; depth: number }[]): Uint32Array {
  const m = mesh.tris.length / 3;
  const order = new Uint32Array(m);
  for (let t = 0; t < m; t++) order[t] = t;
  if (!pins.length || pins.every((p) => p.depth === pins[0].depth)) return order;
  const depth = new Float64Array(m);
  const P = mesh.rest,
    T = mesh.tris;
  for (let t = 0; t < m; t++) {
    const a = T[t * 3],
      b = T[t * 3 + 1],
      c = T[t * 3 + 2];
    const cx = (P[a * 2] + P[b * 2] + P[c * 2]) / 3,
      cy = (P[a * 2 + 1] + P[b * 2 + 1] + P[c * 2 + 1]) / 3;
    let best = Infinity;
    for (const p of pins) {
      const d = (p.x - cx) ** 2 + (p.y - cy) ** 2;
      if (d < best) {
        best = d;
        depth[t] = p.depth;
      }
    }
  }
  return order.sort((a, b) => depth[a] - depth[b] || a - b);
}
