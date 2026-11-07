import { describe, it, expect } from 'vitest';
import { rotationMatrix, rotX, rotY, rotZ, apply3, eulerFromMatrix, trackballRotation, axisAngle, mul3, transpose3, IDENTITY3, dot, normalize, newellNormal } from '../src/features/three-d/math.js';
import { regionsFromRings, area, triangulate, delaunay, insetDirections, flattenSubpaths, insetLimits } from '../src/features/three-d/outline.js';
import { extrudeMesh, revolveMesh, inflateMesh, extrudeStations, cornerNormals, faceNormal, mirrorX, BEVELS } from '../src/features/three-d/mesh.js';
import { anchor } from '../src/model/bezier.js';

const sq = (x, y, s) => [
  [x, y],
  [x + s, y],
  [x + s, y + s],
  [x, y + s],
];
const close = (a, b, eps = 1e-6) => a.every((v, i) => Math.abs(v - b[i]) < eps);
const triArea = (pts, t) => Math.abs(area(t.map((i) => pts[i])));

function centroidOf(mesh, f) {
  const pts = f.rings[0].map((i) => mesh.verts[i]);
  return pts.reduce((s, p) => [s[0] + p[0] / pts.length, s[1] + p[1] / pts.length, s[2] + p[2] / pts.length], [0, 0, 0]);
}

describe('3D rotation math', () => {
  it('uses x right, y down, z toward the viewer with the documented angle senses', () => {
    expect(rotationMatrix(0, 0, 0)).toEqual([...IDENTITY3]);
    // Positive X brings the top face (normal pointing up, -y) toward the viewer.
    expect(close(apply3(rotX(90), [0, -1, 0]), [0, 0, 1])).toBe(true);
    // Positive Y brings the left side toward the viewer.
    expect(close(apply3(rotY(90), [-1, 0, 0]), [0, 0, 1])).toBe(true);
    // Positive Z turns clockwise on screen (y down).
    expect(close(apply3(rotZ(90), [1, 0, 0]), [0, 1, 0])).toBe(true);
  });

  it('applies Z first, then Y, then X', () => {
    const m = rotationMatrix(30, 40, 50);
    const step = apply3(rotX(30), apply3(rotY(40), apply3(rotZ(50), [1, 2, 3])));
    expect(close(apply3(m, [1, 2, 3]), step)).toBe(true);
  });

  it('recovers X/Y/Z angles from a matrix', () => {
    for (const [x, y, z] of [
      [10, 20, 30],
      [-45, 60, -120],
      [170, -10, 5],
      [0, 0, 0],
      [35.26, -45, 0],
    ]) {
      const e = eulerFromMatrix(rotationMatrix(x, y, z));
      expect(close(rotationMatrix(e.x, e.y, e.z), rotationMatrix(x, y, z), 1e-9)).toBe(true);
    }
    // Gimbal lock still gives an equivalent rotation.
    const g = eulerFromMatrix(rotationMatrix(20, 90, 30));
    expect(close(rotationMatrix(g.x, g.y, g.z), rotationMatrix(20, 90, 30), 1e-6)).toBe(true);
  });

  it('builds orthonormal axis rotations and trackball drags that follow the pointer', () => {
    const m = axisAngle([1, 2, 3], 37);
    expect(close(mul3(m, transpose3(m)), [...IDENTITY3], 1e-12)).toBe(true);
    // Dragging right turns the front of the ball to the right.
    const t = trackballRotation(0, 0, 30, 0, 100);
    expect(apply3(t, [0, 0, 1])[0]).toBeGreaterThan(0.2);
    // Dragging down turns the front downward (the top comes forward).
    const d = trackballRotation(0, 0, 0, 30, 100);
    expect(apply3(d, [0, 0, 1])[1]).toBeGreaterThan(0.2);
    expect(apply3(d, [0, -1, 0])[2]).toBeGreaterThan(0.2);
    expect(trackballRotation(5, 5, 5, 5, 100)).toEqual([...IDENTITY3]);
  });
});

describe('3D outlines', () => {
  it('flattens curves adaptively and drops the closing duplicate', () => {
    const r = 50;
    const k = 0.5523 * r;
    const circle = [anchor(r, 0, r, -k, r, k), anchor(0, r, k, r, -k, r), anchor(-r, 0, -r, k, -r, -k), anchor(0, -r, -k, -r, k, -r)];
    const fine = flattenSubpaths([{ anchors: circle, closed: true }], 0.1)[0];
    const coarse = flattenSubpaths([{ anchors: circle, closed: true }], 2)[0];
    expect(fine.closed).toBe(true);
    expect(fine.pts.length).toBeGreaterThan(coarse.pts.length);
    expect(coarse.pts.length).toBeGreaterThanOrEqual(8);
    const [a, b] = [fine.pts[0], fine.pts[fine.pts.length - 1]];
    expect(a[0] === b[0] && a[1] === b[1]).toBe(false);
    // Straight runs collapse to their corners.
    const line = [anchor(0, 0), anchor(5, 0), anchor(10, 0), anchor(10, 10)];
    expect(flattenSubpaths([{ anchors: line, closed: false }])[0].pts).toHaveLength(3);
  });

  it('sorts rings into regions with holes (even-odd nesting) and orients them', () => {
    const regions = regionsFromRings([sq(0, 0, 100), [...sq(20, 20, 60)].reverse(), sq(40, 40, 20), sq(200, 0, 10)]);
    expect(regions).toHaveLength(3);
    const big = regions.find((r) => r.holes.length);
    expect(big.holes).toHaveLength(1);
    expect(area(big.outer)).toBeGreaterThan(0);
    expect(area(big.holes[0])).toBeLessThan(0);
    for (const r of regions) expect(area(r.outer)).toBeGreaterThan(0);
  });

  it('triangulates concave regions with holes without losing area', () => {
    const outer = sq(0, 0, 100);
    const hole = [...sq(30, 30, 40)].reverse();
    const { points, tris } = triangulate(outer, [hole]);
    const sum = tris.reduce((s, t) => s + triArea(points, t), 0);
    expect(sum).toBeCloseTo(100 * 100 - 40 * 40, 6);
    for (const t of tris) expect(area(t.map((i) => points[i]))).toBeGreaterThan(0);
    const L = [
      [0, 0],
      [60, 0],
      [60, 20],
      [20, 20],
      [20, 60],
      [0, 60],
    ];
    const l = triangulate(L);
    expect(l.tris).toHaveLength(4);
    expect(l.tris.reduce((s, t) => s + triArea(l.points, t), 0)).toBeCloseTo(60 * 20 + 20 * 40, 6);
  });

  it('Delaunay triangulates a grid into positive triangles covering it', () => {
    const pts = [];
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) pts.push([x * 10 + y * 0.01, y * 10]);
    const tris = delaunay(pts);
    expect(tris).toHaveLength(8);
    expect(tris.reduce((s, t) => s + triArea(pts, t), 0)).toBeCloseTo(400, 1);
  });

  it('insets toward the inside of outer rings and away from holes', () => {
    const d = insetDirections(sq(0, 0, 10));
    expect(d[0].dir[0]).toBeGreaterThan(0);
    expect(d[0].dir[1]).toBeGreaterThan(0);
    expect(d[0].miter).toBeCloseTo(Math.SQRT2, 6);
    const hole = [...sq(4, 4, 2)].reverse();
    const h = insetDirections(hole);
    // Hole corner (4, 6) after reversing is first; it moves away from the hole's center.
    expect(h[0].dir[0]).toBeLessThan(0);
    const limits = insetLimits([sq(0, 0, 10)], [d]);
    // A corner of a 10pt square can travel half its diagonal before meeting the far side.
    expect(limits[0][0]).toBeCloseTo(Math.hypot(5, 5) / 1, 1);
  });
});

describe('3D meshes', () => {
  const rect = { pts: sq(-50, -25, 50).map(([x, y], i) => (i === 1 || i === 2 ? [x + 50, y] : [x, y])), closed: true };

  it('extrudes a rectangle into a closed box with outward faces', () => {
    const m = extrudeMesh([rect], { depth: 40 });
    expect(m.verts).toHaveLength(8);
    expect(m.faces).toHaveLength(6);
    expect(m.closed).toBe(true);
    expect(m.faces.filter((f) => f.part === 'cap')).toHaveLength(2);
    for (const f of m.faces) expect(dot(faceNormal(m, f), centroidOf(m, f))).toBeGreaterThan(0);
    const zs = m.verts.map((v) => v[2]);
    expect(Math.max(...zs)).toBe(20);
    expect(Math.min(...zs)).toBe(-20);
  });

  it('extrudes holes as inner walls and caps with holes', () => {
    const outer = { pts: sq(-50, -50, 100), closed: true };
    const hole = { pts: sq(-20, -20, 40), closed: true };
    const m = extrudeMesh([outer, hole], { depth: 10 });
    expect(m.verts).toHaveLength(16);
    expect(m.faces).toHaveLength(10);
    const caps = m.faces.filter((f) => f.part === 'cap');
    expect(caps.every((c) => c.rings.length === 2)).toBe(true);
    // Inner walls face the hole's center (outward from the solid).
    const inner = m.faces.filter((f) => f.part === 'side' && f.rings[0].every((i) => Math.abs(m.verts[i][0]) <= 20.001 && Math.abs(m.verts[i][1]) <= 20.001));
    expect(inner).toHaveLength(4);
    for (const f of inner) expect(dot(faceNormal(m, f), centroidOf(m, f))).toBeLessThan(0);
  });

  it('adds bevel stations from each profile', () => {
    const chamfer = extrudeStations({ depth: 40, bevel: 'chamfer', bevelWidth: 5, bevelHeight: 5 });
    expect(chamfer.map((s) => s.z)).toEqual([20, 15, -20]);
    expect(chamfer[0].inset).toBe(5);
    expect(chamfer[1].inset).toBe(0);
    const both = extrudeStations({ depth: 40, bevel: 'chamfer', bevelWidth: 5, bevelHeight: 5, bevelBack: true });
    expect(both.map((s) => s.z)).toEqual([20, 15, -15, -20]);
    const out = extrudeStations({ depth: 40, bevel: 'chamfer', bevelWidth: 5, bevelHeight: 5, bevelOut: true });
    expect(out[0].inset).toBe(0);
    expect(out[1].inset).toBe(-5);
    // Bevels never get deeper than the extrusion.
    const deep = extrudeStations({ depth: 10, bevel: 'round', bevelWidth: 5, bevelHeight: 50, bevelBack: true });
    expect(Math.min(...deep.map((s) => s.z))).toBeCloseTo(-5);
    for (const b of BEVELS) {
      expect(b.points[0]).toEqual([1, 0]);
      expect(b.points[b.points.length - 1]).toEqual([0, 1]);
    }
    const m = extrudeMesh([{ pts: sq(-50, -50, 100), closed: true }], { depth: 40, bevel: 'chamfer', bevelWidth: 5, bevelHeight: 5 });
    expect(m.verts).toHaveLength(12);
    expect(m.faces.filter((f) => f.part === 'bevel')).toHaveLength(4);
    const front = m.faces.find((f) => f.part === 'cap' && faceNormal(m, f)[2] > 0);
    expect(front.rings[0].map((i) => m.verts[i][0]).sort((a, b) => a - b)[0]).toBeCloseTo(-45);
  });

  it('twists and tapers along the depth', () => {
    const m = extrudeMesh([{ pts: sq(-10, -10, 20), closed: true }], { depth: 20, twist: 90, taper: 0.5 });
    const st = extrudeStations({ depth: 20, twist: 90 });
    expect(st.length).toBeGreaterThan(5);
    const back = m.verts.filter((v) => v[2] === -10);
    expect(Math.max(...back.map((v) => Math.hypot(v[0], v[1])))).toBeCloseTo(Math.hypot(5, 5));
  });

  it('extrudes open paths as two-sided ribbons and leaves uncapped solids open', () => {
    const ribbon = extrudeMesh([{ pts: [[0, 0], [10, 0], [20, 10]], closed: false }], { depth: 10 });
    expect(ribbon.faces).toHaveLength(2);
    expect(ribbon.faces.every((f) => f.twoSided)).toBe(true);
    expect(ribbon.closed).toBe(false);
    const tube = extrudeMesh([{ pts: sq(0, 0, 10), closed: true }], { depth: 10, cap: false });
    expect(tube.closed).toBe(false);
    expect(tube.faces).toHaveLength(4);
  });

  it('revolves profiles with the expected vertex and face counts', () => {
    const prof = { pts: [[10, -20], [20, 0], [10, 20]], closed: false };
    const m = revolveMesh([prof], { angle: 360, segments: 12 });
    expect(m.verts).toHaveLength(36);
    expect(m.faces).toHaveLength(24);
    expect(m.closed).toBe(false);
    // Points on the axis share one vertex; their faces become triangles.
    const ball = revolveMesh([{ pts: [[0, -20], [20, 0], [0, 20]], closed: false }], { angle: 360, segments: 12 });
    expect(ball.verts).toHaveLength(14);
    expect(ball.faces).toHaveLength(24);
    expect(ball.faces.every((f) => f.rings[0].length === 3)).toBe(true);
    // A partial turn adds a column and, for closed profiles, two end caps.
    const half = revolveMesh([{ pts: [[10, -5], [20, -5], [20, 5], [10, 5]], closed: true }], { angle: 180, segments: 24 });
    expect(half.verts).toHaveLength(4 * 13);
    expect(half.faces).toHaveLength(4 * 12 + 2);
    expect(half.closed).toBe(true);
  });

  it('points revolved faces outward and mirrors for the right-hand axis', () => {
    const ring = revolveMesh([{ pts: [[10, -5], [20, -5], [20, 5], [10, 5]], closed: true }], { angle: 360, segments: 16 });
    expect(ring.closed).toBe(true);
    for (const f of ring.faces) {
      const c = centroidOf(ring, f);
      const r = Math.hypot(c[0], c[2]);
      const n = faceNormal(ring, f);
      if (r > 19) expect(n[0] * c[0] + n[2] * c[2]).toBeGreaterThan(0);
      if (r < 11) expect(n[0] * c[0] + n[2] * c[2]).toBeLessThan(0);
      if (Math.abs(c[1] + 5) < 1e-9) expect(n[1]).toBeLessThan(-0.9);
    }
    const m = mirrorX(ring);
    for (const f of m.faces) {
      const c = centroidOf(m, f);
      if (Math.hypot(c[0], c[2]) > 19) expect(dot(faceNormal(m, f), [c[0], 0, c[2]])).toBeGreaterThan(0);
    }
  });

  it('inflates outlines into closed cushions with a smooth dome', () => {
    const pts = [];
    for (let i = 0; i < 48; i++) pts.push([Math.cos((i / 48) * 2 * Math.PI) * 50, Math.sin((i / 48) * 2 * Math.PI) * 50]);
    const m = inflateMesh([{ pts, closed: true }], { depth: 0, volume: 1, grid: 20 });
    expect(m.closed).toBe(true);
    const top = Math.max(...m.verts.map((v) => v[2]));
    expect(top).toBeGreaterThan(40);
    expect(top).toBeLessThanOrEqual(50.001);
    expect(Math.min(...m.verts.map((v) => v[2]))).toBeCloseTo(0, 9);
    const front = m.faces.filter((f) => f.part === 'surface');
    for (const f of front) expect(faceNormal(m, f)[2]).toBeGreaterThan(-1e-9);
    // Smooth normals near the middle point straight at the viewer.
    const corners = cornerNormals(m);
    let best = null;
    m.faces.forEach((f, fi) => {
      if (f.part !== 'surface') return;
      f.rings[0].forEach((v, k) => {
        const p = m.verts[v];
        if (!best || Math.hypot(p[0], p[1]) < best.d) best = { d: Math.hypot(p[0], p[1]), n: corners[fi][k] };
      });
    });
    expect(best.n[2]).toBeGreaterThan(0.95);
    // Both sides puff the back too, and a side wall adds depth.
    const both = inflateMesh([{ pts, closed: true }], { depth: 10, volume: 0.5, bothSides: true, grid: 12 });
    expect(Math.min(...both.verts.map((v) => v[2]))).toBeLessThan(-20);
    expect(both.faces.some((f) => f.part === 'side')).toBe(true);
  });

  it('keeps sharp corners sharp and curved runs smooth', () => {
    const m = extrudeMesh([{ pts: sq(-10, -10, 20), closed: true }], { depth: 10 });
    const corners = cornerNormals(m);
    m.faces.forEach((f, fi) => {
      if (f.part !== 'side') return;
      const n = faceNormal(m, f);
      for (const c of corners[fi]) expect(dot(c, n)).toBeCloseTo(1, 6);
    });
    const pts = [];
    for (let i = 0; i < 32; i++) pts.push([Math.cos((i / 32) * 2 * Math.PI) * 50, Math.sin((i / 32) * 2 * Math.PI) * 50]);
    const cyl = extrudeMesh([{ pts, closed: true }], { depth: 10 });
    const cc = cornerNormals(cyl);
    const fi = cyl.faces.findIndex((f) => f.part === 'side');
    expect(dot(cc[fi][0], faceNormal(cyl, cyl.faces[fi]))).toBeLessThan(0.9999);
    expect(normalize(newellNormal(cyl.faces[fi].rings[0].map((i) => cyl.verts[i])))[2]).toBeCloseTo(0, 6);
  });
});
