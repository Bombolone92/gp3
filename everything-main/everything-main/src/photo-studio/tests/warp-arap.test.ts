import { describe, expect, it } from 'vitest';
import { EnvelopeCholesky, SymmetricBuilder, rcmOrder } from '../src/imaging/warp/sparse';
import { buildPinMesh, locateInMesh, meshEdges, meshPoint, type TriMesh } from '../src/imaging/warp/pin-mesh';
import { ArapSolver, triangleOrder, type ArapPin } from '../src/imaging/warp/arap';
import { renderTriangles, triangleBounds } from '../src/imaging/warp/triangles';
import { rgba8 } from '../src/imaging/types';

function opaque(w: number, h: number) {
  return rgba8(w, h, [200, 100, 50, 255]);
}
function pinAt(mesh: TriMesh, x: number, y: number, tx = x, ty = y, angle?: number): ArapPin {
  const hit = locateInMesh(mesh.rest, mesh.tris, x, y)!;
  return { tri: hit.tri, bary: hit.bary, x: tx, y: ty, angle };
}
function edgeLengthError(mesh: TriMesh, pos: Float64Array) {
  const edges = meshEdges(mesh.tris);
  let worst = 0;
  for (let k = 0; k < edges.length; k += 2) {
    const a = edges[k],
      b = edges[k + 1];
    const r = Math.hypot(mesh.rest[b * 2] - mesh.rest[a * 2], mesh.rest[b * 2 + 1] - mesh.rest[a * 2 + 1]);
    const d = Math.hypot(pos[b * 2] - pos[a * 2], pos[b * 2 + 1] - pos[a * 2 + 1]);
    worst = Math.max(worst, Math.abs(d - r) / r);
  }
  return worst;
}
function meanEdgeLengthError(mesh: TriMesh, pos: Float64Array) {
  const edges = meshEdges(mesh.tris);
  let sum = 0;
  for (let k = 0; k < edges.length; k += 2) {
    const a = edges[k],
      b = edges[k + 1];
    const r = Math.hypot(mesh.rest[b * 2] - mesh.rest[a * 2], mesh.rest[b * 2 + 1] - mesh.rest[a * 2 + 1]);
    const d = Math.hypot(pos[b * 2] - pos[a * 2], pos[b * 2 + 1] - pos[a * 2 + 1]);
    sum += Math.abs(d - r) / r;
  }
  return sum / (edges.length / 2);
}

describe('sparse Cholesky', () => {
  it('solves a banded SPD system in a reverse Cuthill-McKee order', () => {
    // 1D Laplacian plus identity on a shuffled numbering.
    const n = 40;
    const ids = Array.from({ length: n }, (_, i) => (i * 17) % n);
    const A = new SymmetricBuilder(n);
    for (let i = 0; i < n; i++) A.add(ids[i], ids[i], 3);
    for (let i = 0; i + 1 < n; i++) A.add(ids[i], ids[i + 1], -1);
    const order = rcmOrder(A.adjacency());
    expect(new Set(order).size).toBe(n);
    const chol = new EnvelopeCholesky(A, order);
    // The reordered chain has bandwidth 1, so the factor stays tiny.
    expect(chol.size).toBeLessThanOrEqual(2 * n);
    const x = Float64Array.from({ length: n }, (_, i) => Math.sin(i));
    const b = new Float64Array(n);
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) b[i] += A.get(i, j) * x[j];
    const solved = chol.solve(b);
    for (let i = 0; i < n; i++) expect(solved[i]).toBeCloseTo(x[i], 9);
  });
  it('rejects matrices that are not positive definite', () => {
    const A = new SymmetricBuilder(2);
    A.add(0, 0, 1);
    A.add(1, 1, 1);
    A.add(0, 1, 2);
    expect(() => new EnvelopeCholesky(A)).toThrow();
  });
});

describe('pin mesh', () => {
  it('covers every visible pixel and skips empty areas', () => {
    const img = rgba8(100, 60);
    // Two separate opaque blocks.
    for (let y = 5; y < 25; y++)
      for (let x = 5; x < 30; x++) img.data[(y * 100 + x) * 4 + 3] = 255;
    for (let y = 35; y < 55; y++)
      for (let x = 70; x < 95; x++) img.data[(y * 100 + x) * 4 + 3] = 255;
    const mesh = buildPinMesh(img, 'more', 2)!;
    for (const [x, y] of [
      [5.5, 5.5],
      [29.5, 24.5],
      [70.5, 35.5],
      [94.5, 54.5],
    ])
      expect(locateInMesh(mesh.rest, mesh.tris, x, y)).toBeDefined();
    // The empty middle of the image has no triangles.
    expect(locateInMesh(mesh.rest, mesh.tris, 50, 30)).toBeUndefined();
    expect(buildPinMesh(rgba8(10, 10), 'normal')).toBeUndefined();
  });
  it('density sets the number of cells', () => {
    const img = opaque(300, 200);
    const counts = (['fewer', 'normal', 'more'] as const).map((d) => buildPinMesh(img, d)!.tris.length / 6);
    expect(counts[0]).toBeLessThan(counts[1]);
    expect(counts[1]).toBeLessThan(counts[2]);
    expect(counts[1]).toBeGreaterThan(300);
    expect(counts[1]).toBeLessThan(900);
  });
});

describe('as-rigid-as-possible solve', () => {
  const mesh = buildPinMesh(opaque(200, 100), 'normal', 0)!;

  it('keeps the mesh still with no pins and translates rigidly with one', () => {
    const s = new ArapSolver(mesh);
    s.settle([]);
    for (let i = 0; i < mesh.rest.length; i++) expect(s.pos[i]).toBeCloseTo(mesh.rest[i], 6);
    s.settle([pinAt(mesh, 100, 50, 130, 40)]);
    for (let i = 0; i < mesh.rest.length; i += 2) {
      expect(s.pos[i] - mesh.rest[i]).toBeCloseTo(30, 2);
      expect(s.pos[i + 1] - mesh.rest[i + 1]).toBeCloseTo(-10, 2);
    }
  });

  it('keeps parts of the mesh without pins in place', () => {
    const img = rgba8(120, 40);
    for (let y = 0; y < 40; y++)
      for (let x = 0; x < 120; x++) if (x < 40 || x >= 80) img.data[(y * 120 + x) * 4 + 3] = 255;
    const two = buildPinMesh(img, 'normal', 0)!;
    const s = new ArapSolver(two);
    s.settle([pinAt(two, 20, 20, 30, 25)]);
    const right = locateInMesh(two.rest, two.tris, 100, 20)!;
    const q = s.currentPoint(right);
    expect(q.x).toBeCloseTo(100, 3);
    expect(q.y).toBeCloseTo(20, 3);
  });

  it('turns rigidly when two pins rotate about the centre', () => {
    const s = new ArapSolver(mesh);
    s.mode = 'rigid';
    // Rotate 90 degrees about (100, 50): (40, 50) -> (100, -10), (160, 50) -> (100, 110).
    const pins = [pinAt(mesh, 40, 50, 100, -10), pinAt(mesh, 160, 50, 100, 110)];
    s.settle(pins, 18, 30, 300);
    for (let i = 0; i < mesh.rest.length; i += 2) {
      const dx = mesh.rest[i] - 100,
        dy = mesh.rest[i + 1] - 50;
      expect(Math.hypot(s.pos[i] - (100 - dy), s.pos[i + 1] - (50 + dx))).toBeLessThan(0.05);
    }
    expect(edgeLengthError(mesh, s.pos)).toBeLessThan(1e-3);
    expect(s.pinAngle(pins[0])).toBeCloseTo(Math.PI / 2, 3);
  });

  it('holds pins and bends the rest; rigid mode preserves lengths better than distort', () => {
    const pins = [pinAt(mesh, 10, 50), pinAt(mesh, 100, 50, 100, 90), pinAt(mesh, 190, 50)];
    const run = (mode: 'rigid' | 'distort') => {
      const s = new ArapSolver(mesh);
      s.mode = mode;
      s.settle(pins);
      for (const p of pins) {
        const q = s.currentPoint(p);
        expect(Math.hypot(q.x - p.x, q.y - p.y)).toBeLessThan(0.05);
      }
      return s;
    };
    expect(meanEdgeLengthError(mesh, run('rigid').pos)).toBeLessThan(meanEdgeLengthError(mesh, run('distort').pos));
  });

  it('reaches the same shape by dragging as by settling from rest', () => {
    const base = [pinAt(mesh, 20, 20), pinAt(mesh, 180, 80)];
    const dragged = new ArapSolver(mesh);
    dragged.mode = 'rigid';
    dragged.setPins(base);
    for (let k = 1; k <= 20; k++) {
      dragged.setPins([base[0], { ...base[1], x: 180 + 2 * k, y: 80 - 1.5 * k }]);
      dragged.iterate(5);
    }
    dragged.iterate(500);
    const settled = new ArapSolver(mesh);
    settled.mode = 'rigid';
    settled.settle([base[0], { ...base[1], x: 220, y: 50 }], 10, 30, 500);
    let worst = 0;
    for (let i = 0; i < mesh.rest.length; i++) worst = Math.max(worst, Math.abs(dragged.pos[i] - settled.pos[i]));
    expect(worst).toBeLessThan(0.25);
  });

  it('fixed pin angles turn the surrounding area', () => {
    const s = new ArapSolver(mesh);
    s.mode = 'rigid';
    const p = pinAt(mesh, 100, 50, 100, 50, Math.PI / 6);
    s.settle([p], 10, 30, 400);
    expect(s.pinAngle(p)).toBeCloseTo(Math.PI / 6, 6);
    // With one pin the whole mesh turns about it.
    const corner = 0;
    const dx = mesh.rest[corner] - 100,
      dy = mesh.rest[corner + 1] - 50;
    const c = Math.cos(Math.PI / 6),
      sn = Math.sin(Math.PI / 6);
    expect(Math.hypot(s.pos[corner] - (100 + c * dx - sn * dy), s.pos[corner + 1] - (50 + sn * dx + c * dy))).toBeLessThan(1);
  });

  it('solves interactive frames quickly', () => {
    const big = buildPinMesh(opaque(1200, 900), 'more', 2)!;
    const s = new ArapSolver(big);
    s.mode = 'rigid';
    const pins = [pinAt(big, 100, 100), pinAt(big, 1100, 800), pinAt(big, 600, 450)];
    s.setPins(pins);
    s.iterate(1);
    const t0 = performance.now();
    for (let k = 1; k <= 10; k++) {
      s.setPins(pins.map((p, i) => (i === 2 ? { ...p, x: 600 + 10 * k } : p)));
      s.iterate(10);
    }
    // 100 iterations on a ~1500 vertex mesh; generous for loaded CI machines.
    expect(performance.now() - t0).toBeLessThan(2000);
  });
});

describe('triangle rendering and depth', () => {
  it('reproduces the source through an identity mesh and moves with the mesh', () => {
    const img = rgba8(40, 30);
    for (let i = 0; i < 40 * 30; i++) img.data.set([(i % 40) * 6, Math.floor(i / 40) * 8, 90, 255], i * 4);
    const mesh = buildPinMesh(img, 'normal', 0)!;
    const same = renderTriangles(img, { src: mesh.rest, dst: mesh.rest, tris: mesh.tris }, { x: 0, y: 0, width: 40, height: 30 }, 'nearest');
    expect(Array.from(same.data)).toEqual(Array.from(img.data));
    const moved = new Float64Array(mesh.rest);
    for (let i = 0; i < moved.length; i += 2) moved[i] += 5;
    const b = triangleBounds(moved, mesh.tris);
    expect(b.x).toBeLessThanOrEqual(5);
    const shifted = renderTriangles(img, { src: mesh.rest, dst: moved, tris: mesh.tris }, { x: 5, y: 0, width: 40, height: 30 }, 'nearest');
    expect(Array.from(shifted.data)).toEqual(Array.from(img.data));
  });
  it('orders triangles by the depth of the nearest pin', () => {
    const mesh = buildPinMesh(opaque(100, 20), 'fewer', 0)!;
    const order = triangleOrder(mesh, [
      { x: 10, y: 10, depth: 1 },
      { x: 90, y: 10, depth: 0 },
    ]);
    // The left end (deeper pin) draws last.
    const last = order[order.length - 1];
    const c = meshPoint(mesh.rest, mesh.tris, last, [1 / 3, 1 / 3, 1 / 3]);
    expect(c.x).toBeLessThan(50);
    const first = meshPoint(mesh.rest, mesh.tris, order[0], [1 / 3, 1 / 3, 1 / 3]);
    expect(first.x).toBeGreaterThan(50);
  });
});
