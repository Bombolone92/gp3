import { describe, it, expect, beforeAll } from 'vitest';
import { installCanvasStub } from './helpers.js';
import { rectangle, ellipse, polygon } from '../src/model/shapes.js';
import { pathBounds, pointAt } from '../src/model/bezier.js';
import {
  meshFromOutline,
  patchOf,
  evalPatch,
  patchColor,
  insertColumn,
  insertRow,
  removeColumn,
  removeRow,
  locate,
  nearestEdge,
  nearestPoint,
  meshBoundary,
  meshBounds,
  addPointAt,
  slidePoint,
  slideTarget,
  chainPieces,
  outlineSides,
  transformPoints,
  isoS,
  idx,
} from '../src/features/mesh/mesh-model.js';
import { rasterizeMesh, shadeTriangle, encodePNG, patchSteps } from '../src/features/mesh/mesh-raster.js';

beforeAll(() => installCanvasStub());

const mesh = (anchors, opts) => ({ id: 'm1', type: 'mesh', ...meshFromOutline(anchors, opts) });

describe('mesh construction', () => {
  it('turns a rectangle into a grid with exact corners and straight lines', () => {
    const m = mesh(rectangle(0, 0, 100, 50), { rows: 2, cols: 4, color: '#336699' });
    expect(m.rows).toBe(2);
    expect(m.cols).toBe(4);
    expect(m.points).toHaveLength(3 * 5);
    const p = m.points[idx(m, 1, 2)];
    expect(p.x).toBeCloseTo(50);
    expect(p.y).toBeCloseTo(25);
    expect(m.points[idx(m, 0, 0)]).toMatchObject({ x: 0, y: 0 });
    expect(m.points[idx(m, 2, 4)].x).toBeCloseTo(100);
    expect(m.points[idx(m, 2, 4)].y).toBeCloseTo(50);
    expect(m.points.every((q) => q.c === '#336699' && q.a === 1)).toBe(true);
    const b = meshBounds(m);
    expect(b.x).toBeCloseTo(0);
    expect(b.w).toBeCloseTo(100);
    expect(b.h).toBeCloseTo(50);
  });

  it('keeps an ellipse outline exactly with its natural grid', () => {
    const e = ellipse(0, 0, 200, 100);
    const m = mesh(e);
    expect(m.rows).toBe(1);
    expect(m.cols).toBe(1);
    const b = pathBounds(meshBoundary(m), true);
    expect(b.x).toBeCloseTo(0, 6);
    expect(b.y).toBeCloseTo(0, 6);
    expect(b.w).toBeCloseTo(200, 6);
    expect(b.h).toBeCloseTo(100, 6);
    // The mesh surface covers the ellipse center.
    expect(locate(m, 100, 50)).not.toBeNull();
    expect(locate(m, 3, 3)).toBeNull();
  });

  it('splits sides with more segments to the natural grid and picks four corners', () => {
    const hex = polygon(50, 50, 40, 6);
    const sides = outlineSides(hex);
    const total = sides.top.length + sides.right.length + sides.bottom.length + sides.left.length;
    expect(total).toBe(6);
    const m = mesh(hex);
    expect(m.rows * m.cols).toBeGreaterThanOrEqual(1);
    const b = meshBounds(m);
    const pb = pathBounds(hex, true);
    expect(b.w).toBeCloseTo(pb.w, 4);
    expect(b.h).toBeCloseTo(pb.h, 4);
  });

  it('accepts triangles and reversed outlines', () => {
    const tri = [
      { x: 0, y: 0, ix: 0, iy: 0, ox: 0, oy: 0 },
      { x: 0, y: 80, ix: 0, iy: 80, ox: 0, oy: 80 },
      { x: 80, y: 80, ix: 80, iy: 80, ox: 80, oy: 80 },
    ];
    const m = mesh(tri, { rows: 2, cols: 2 });
    expect(m.points).toHaveLength(9);
    const b = meshBounds(m);
    expect(b.w).toBeCloseTo(80, 4);
    expect(b.h).toBeCloseTo(80, 4);
  });

  it('applies highlight appearances', () => {
    const center = mesh(rectangle(0, 0, 90, 90), { rows: 3, cols: 3, color: '#000000', appearance: 'center', highlight: 1 });
    expect(center.points[idx(center, 1, 1)].c).toBe('#ffffff');
    expect(center.points[idx(center, 0, 0)].c).toBe('#000000');
    const edge = mesh(rectangle(0, 0, 90, 90), { rows: 3, cols: 3, color: '#000000', appearance: 'edge', highlight: 0.5 });
    expect(edge.points[idx(edge, 0, 1)].c).toBe('#808080');
    expect(edge.points[idx(edge, 1, 1)].c).toBe('#000000');
  });

  it('splits chains into pieces exactly inside segments', () => {
    const c = [0, 0, 10, 0, 20, 0, 30, 0];
    const pieces = chainPieces([c], 3);
    expect(pieces).toHaveLength(3);
    expect(pieces[1][0]).toBeCloseTo(10);
    expect(pieces[1][6]).toBeCloseTo(20);
    const two = chainPieces([c, [30, 0, 40, 0, 50, 0, 60, 0]], 1);
    expect(two[0][0]).toBe(0);
    expect(two[0][6]).toBe(60);
  });
});

describe('patch evaluation and color', () => {
  it('evaluates a Coons patch at its corners and boundary', () => {
    const m = mesh(ellipse(0, 0, 100, 60));
    const p = patchOf(m, 0, 0);
    const a = evalPatch(p, 0, 0);
    expect(a.x).toBeCloseTo(p.A.x);
    expect(a.y).toBeCloseTo(p.A.y);
    const c = evalPatch(p, 1, 1);
    expect(c.x).toBeCloseTo(p.C.x);
    const mid = evalPatch(p, 0.3, 0);
    const onTop = pointAt(p.top, 0.3);
    expect(mid.x).toBeCloseTo(onTop.x);
    expect(mid.y).toBeCloseTo(onTop.y);
  });

  it('interpolates colors bilinearly', () => {
    const m = mesh(rectangle(0, 0, 10, 10), { color: '#000000' });
    m.points[1] = { ...m.points[1], c: '#ff0000' };
    m.points[3] = { ...m.points[3], c: '#0000ff', a: 0 };
    const c = patchColor(m, 0, 0, 0.5, 0.5);
    expect(c[0]).toBeCloseTo(255 / 4);
    expect(c[2]).toBeCloseTo(255 / 4);
    expect(c[3]).toBeCloseTo(0.75);
    expect(patchColor(m, 0, 0, 1, 0)[0]).toBeCloseTo(255);
  });

  it('inserts lines without changing the surface or colors', () => {
    let m = mesh(ellipse(0, 0, 100, 60), { color: '#000000' });
    m.points[0] = { ...m.points[0], c: '#ffffff' };
    const before = patchOf(m, 0, 0);
    const probe = evalPatch(before, 0.7, 0.4);
    const color = patchColor(m, 0, 0, 0.7, 0.4);
    m = { ...m, ...insertColumn(m, 0, 0.5) };
    expect(m.cols).toBe(2);
    // (0.7, 0.4) in the old patch is (0.4, 0.4) in the right half.
    const after = evalPatch(patchOf(m, 0, 1), 0.4, 0.4);
    expect(after.x).toBeCloseTo(probe.x, 6);
    expect(after.y).toBeCloseTo(probe.y, 6);
    const c2 = patchColor(m, 0, 1, 0.4, 0.4);
    for (let k = 0; k < 4; k++) expect(c2[k]).toBeCloseTo(color[k], 0);
    m = { ...m, ...insertRow(m, 0, 0.25) };
    expect(m.rows).toBe(2);
    const again = evalPatch(patchOf(m, 1, 1), 0.4, 0.2);
    expect(again.x).toBeCloseTo(probe.x, 6);
    expect(again.y).toBeCloseTo(probe.y, 6);
  });

  it('iso-curves are the exact Coons lines', () => {
    const m = mesh(ellipse(0, 0, 80, 40));
    const p = patchOf(m, 0, 0);
    const iso = isoS(p, 0.35);
    for (const t of [0, 0.2, 0.6, 1]) {
      const a = pointAt(iso, t);
      const b = evalPatch(p, 0.35, t);
      expect(a.x).toBeCloseTo(b.x, 6);
      expect(a.y).toBeCloseTo(b.y, 6);
    }
  });

  it('removes inserted lines and restores the shape', () => {
    const m0 = mesh(ellipse(0, 0, 100, 60));
    const m1 = { ...m0, ...insertColumn(m0, 0, 0.3) };
    const m2 = { ...m1, ...removeColumn(m1, 1) };
    expect(m2.cols).toBe(1);
    for (const k of ['rx', 'ry', 'lx', 'ly']) expect(m2.points[0][k]).toBeCloseTo(m0.points[0][k], 6);
    const r1 = { ...m0, ...insertRow(m0, 0, 0.6) };
    const r2 = { ...r1, ...removeRow(r1, 1) };
    expect(r2.rows).toBe(1);
    expect(r2.points[0].dy).toBeCloseTo(m0.points[0].dy, 6);
    // Outline lines are never removed.
    expect(removeColumn(m0, 0)).toBe(m0);
  });

  it('slides a point along its line', () => {
    const m0 = mesh(rectangle(0, 0, 100, 100), { rows: 2, cols: 2 });
    const k = idx(m0, 1, 1);
    const target = slideTarget(m0, k, 70, 52);
    expect(target.axis).toBe('h');
    const m1 = slidePoint(m0, k, target.axis, target.u);
    expect(m1.points[k].x).toBeCloseTo(70, 0);
    expect(m1.points[k].y).toBeCloseTo(50, 6);
  });

  it('transforms points and handles', () => {
    const m = mesh(rectangle(0, 0, 10, 10));
    const t = transformPoints(m.points, [2, 0, 0, 2, 5, 5]);
    expect(t[3]).toMatchObject({ x: 25, y: 25 });
    expect(t[0].rx).toBeCloseTo(5 + (m.points[0].rx * 2));
  });
});

describe('mesh hit testing', () => {
  it('locates patches and parameters', () => {
    const m = mesh(rectangle(0, 0, 100, 100), { rows: 2, cols: 2 });
    const hit = locate(m, 75, 25);
    expect(hit).toMatchObject({ i: 0, j: 1 });
    expect(hit.s).toBeCloseTo(0.5, 4);
    expect(hit.t).toBeCloseTo(0.5, 4);
    expect(locate(m, 150, 20)).toBeNull();
  });

  it('finds lines and points', () => {
    const m = mesh(rectangle(0, 0, 100, 100), { rows: 2, cols: 2 });
    const e = nearestEdge(m, 25, 51, 2);
    expect(e).toMatchObject({ kind: 'h', i: 1, j: 0 });
    expect(e.t).toBeCloseTo(0.5, 3);
    expect(nearestEdge(m, 25, 30, 2)).toBeNull();
    expect(nearestPoint(m, 51, 49, 3)).toBe(idx(m, 1, 1));
    expect(nearestPoint(m, 60, 60, 3)).toBe(-1);
  });

  it('adds mesh points inside patches and on lines', () => {
    const m = mesh(rectangle(0, 0, 100, 100));
    const a = addPointAt(m, 30, 70);
    expect(a.mesh.rows).toBe(2);
    expect(a.mesh.cols).toBe(2);
    expect(a.mesh.points[a.k].x).toBeCloseTo(30, 3);
    expect(a.mesh.points[a.k].y).toBeCloseTo(70, 3);
    const b = addPointAt({ ...m, ...a.mesh }, 60, 70.5, 2);
    // On the new row line: one more column.
    expect(b.mesh.rows).toBe(2);
    expect(b.mesh.cols).toBe(3);
    expect(b.mesh.points[b.k].x).toBeCloseTo(60, 1);
    expect(addPointAt(m, 200, 200)).toBeNull();
  });
});

describe('mesh rasterization', () => {
  it('shades triangles with interpolated colors', () => {
    const W = 10;
    const H = 10;
    const buf = new Uint8ClampedArray(W * H * 4);
    const mask = new Uint8Array(W * H);
    shadeTriangle(buf, mask, W, H, 0, 0, [255, 0, 0, 1], 10, 0, [0, 0, 255, 1], 0, 10, [0, 255, 0, 1]);
    const at = (x, y) => [...buf.subarray((y * W + x) * 4, (y * W + x) * 4 + 4)];
    expect(at(0, 0)[0]).toBeGreaterThan(200);
    expect(at(8, 0)[2]).toBeGreaterThan(180);
    expect(mask[9 * W + 9]).toBe(0);
    expect(at(0, 0)[3]).toBe(255);
  });

  it('renders a mesh with its corner colors and no gaps', () => {
    const m = mesh(rectangle(0, 0, 40, 40), { rows: 2, cols: 2, color: '#000000' });
    m.points[idx(m, 2, 2)] = { ...m.points[idx(m, 2, 2)], c: '#ffffff' };
    const r = rasterizeMesh(m, [1, 0, 0, 1, 0, 0], 40, 40, { dilate: false });
    let covered = 0;
    for (const v of r.mask) covered += v ? 1 : 0;
    expect(covered).toBe(40 * 40);
    const px = (x, y) => r.data[(y * 40 + x) * 4];
    expect(px(1, 1)).toBeLessThan(5);
    expect(px(38, 38)).toBeGreaterThan(200);
    expect(px(30, 30)).toBeGreaterThan(px(25, 25));
    expect(px(10, 10)).toBe(0);
  });

  it('dilates the edge for anti-aliased clipping', () => {
    const m = mesh(rectangle(10.3, 10.3, 20, 20), { color: '#ff0000' });
    const r = rasterizeMesh(m, [1, 0, 0, 1, 0, 0], 40, 40);
    expect(r.mask[15 * 40 + 10]).toBe(1);
    expect(r.mask[15 * 40 + 9]).toBe(2);
    expect(r.data[(15 * 40 + 9) * 4]).toBe(255);
    expect(r.mask[15 * 40 + 5]).toBe(0);
  });

  it('subdivides by device size', () => {
    const top = [0, 0, 100, 0, 200, 0, 400, 0];
    const left = [0, 0, 0, 10, 0, 20, 0, 40];
    const s = patchSteps(top, top, left, left);
    expect(s.ns).toBe(100);
    expect(s.nt).toBe(10);
  });

  it('encodes PNG files', () => {
    const png = encodePNG(new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 128]), 2, 1);
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(String.fromCharCode(...png.subarray(12, 16))).toBe('IHDR');
  });
});
