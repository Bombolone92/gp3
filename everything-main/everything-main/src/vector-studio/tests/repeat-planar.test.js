import { describe, it, expect } from 'vitest';
import { buildPlanarMap, faceAt, edgeAt, intersectCubics, faceSubpaths, interiorPoints, pointInPolys } from '../src/features/regions/planar.js';
import { rectangle, ellipse } from '../src/model/shapes.js';
import { anchor, segmentCount, segmentPoints, signedArea, pointAt } from '../src/model/bezier.js';

/** Curves of a path: { c, owner } per segment. */
function curvesOf(anchors, closed, owner) {
  const out = [];
  for (let i = 0; i < segmentCount(anchors, closed); i++) out.push({ c: segmentPoints(anchors, i), owner });
  return out;
}
const line = (x1, y1, x2, y2, owner = 'l') => curvesOf([anchor(x1, y1), anchor(x2, y2)], false, owner);
const areas = (map) => map.faces.map((f) => Math.round(f.area)).sort((a, b) => a - b);

describe('cubic intersections', () => {
  it('finds line, curve and overlap crossings', () => {
    const h = [0, 0, 0, 0, 10, 0, 10, 0];
    const v = [5, -5, 5, -5, 5, 5, 5, 5];
    const hits = intersectCubics(h, v);
    expect(hits).toHaveLength(1);
    expect(pointAt(h, hits[0][0]).x).toBeCloseTo(5, 3);
    // A circle quarter against a diagonal.
    const circle = ellipse(0, 0, 20, 20);
    let n = 0;
    for (let i = 0; i < 4; i++) n += intersectCubics(segmentPoints(circle, i), [0, 0, 0, 0, 20, 20, 20, 20]).length;
    expect(n).toBe(2);
  });
});

describe('planar map', () => {
  it('one square: one face with its area', () => {
    const map = buildPlanarMap(curvesOf(rectangle(0, 0, 10, 10), true, 'a'));
    expect(map.faces).toHaveLength(1);
    expect(map.faces[0].area).toBeCloseTo(100);
    expect(map.edges).toHaveLength(4);
    expect(faceAt(map, 5, 5)).toBe(map.faces[0]);
    expect(faceAt(map, 15, 5)).toBe(null);
  });

  it('two overlapping squares: three faces', () => {
    const map = buildPlanarMap([...curvesOf(rectangle(0, 0, 10, 10), true, 'a'), ...curvesOf(rectangle(5, 5, 10, 10), true, 'b')]);
    expect(areas(map)).toEqual([25, 75, 75]);
    expect(faceAt(map, 7, 7).area).toBeCloseTo(25);
  });

  it('a line across a square splits it, and its outside parts dangle', () => {
    const map = buildPlanarMap([...curvesOf(rectangle(0, 0, 10, 10), true, 'a'), ...line(-5, 5, 15, 5)]);
    expect(areas(map)).toEqual([50, 50]);
    // 4 square sides, 2 of them cut, plus 3 pieces of the line.
    expect(map.edges).toHaveLength(9);
    const e = edgeAt(map, -3, 5, 0.5);
    expect(e.owner).toBe('l');
  });

  it('shared edges of touching squares are kept once with both owners', () => {
    const map = buildPlanarMap([...curvesOf(rectangle(0, 0, 10, 10), true, 'a'), ...curvesOf(rectangle(10, 0, 10, 10), true, 'b')]);
    expect(areas(map)).toEqual([100, 100]);
    const shared = edgeAt(map, 10, 5, 0.1);
    expect(shared.owners.sort()).toEqual(['a', 'b']);
    expect(map.edges).toHaveLength(7);
  });

  it('a ring inside a square leaves a hole in the square face', () => {
    const map = buildPlanarMap([...curvesOf(rectangle(0, 0, 100, 100), true, 'sq'), ...curvesOf(ellipse(30, 30, 40, 40), true, 'c')]);
    expect(map.faces).toHaveLength(2);
    const outer = faceAt(map, 10, 10);
    const inner = faceAt(map, 50, 50);
    expect(outer).not.toBe(inner);
    expect(inner.area).toBeCloseTo(Math.PI * 400, -1);
    expect(outer.area).toBeCloseTo(10000 - Math.PI * 400, -1);
    expect(outer.holes).toHaveLength(1);
    // The face outline has the hole as its second subpath, drawn the other way round.
    const subs = faceSubpaths(map, outer);
    expect(subs).toHaveLength(2);
    expect(Math.sign(signedArea(subs[0].anchors))).toBe(-Math.sign(signedArea(subs[1].anchors)));
  });

  it('curves crossing curves: two circles make three faces', () => {
    const map = buildPlanarMap([...curvesOf(ellipse(0, 0, 100, 100), true, 'a'), ...curvesOf(ellipse(60, 0, 100, 100), true, 'b')]);
    expect(map.faces).toHaveLength(3);
    const total = map.faces.reduce((s, f) => s + f.area, 0);
    // Union of two r=50 circles 60 apart.
    const r = 50;
    const d = 60;
    const lens = 2 * r * r * Math.acos(d / (2 * r)) - (d / 2) * Math.sqrt(4 * r * r - d * d);
    // Four-segment curves are within a few hundredths of a percent of true circles.
    expect(Math.abs(total / (2 * Math.PI * r * r - lens) - 1)).toBeLessThan(0.002);
    expect(Math.abs(faceAt(map, 80, 50).area / lens - 1)).toBeLessThan(0.002);
  });

  it('closes gaps up to the gap size with invisible gap edges', () => {
    // A square with a 2pt gap in its top side.
    const open = curvesOf([anchor(6, 0), anchor(10, 0), anchor(10, 10), anchor(0, 10), anchor(0, 0), anchor(4, 0)], false, 'a');
    expect(buildPlanarMap(open).faces).toHaveLength(0);
    const small = buildPlanarMap(open, { gap: 1 });
    expect(small.faces).toHaveLength(0);
    const map = buildPlanarMap(open, { gap: 3 });
    expect(map.gaps).toHaveLength(1);
    expect(map.gaps[0].length).toBeCloseTo(2);
    expect(map.faces).toHaveLength(1);
    expect(map.faces[0].area).toBeCloseTo(100);
    expect(map.edges.filter((e) => e.kind === 'gap')).toHaveLength(1);
    // A line ending just short of a side closes onto that side.
    const t = buildPlanarMap([...curvesOf(rectangle(0, 0, 10, 10), true, 'a'), ...line(5, 0, 5, 9)], { gap: 2 });
    expect(areas(t)).toEqual([50, 50]);
  });

  it('a self-crossing path makes faces at its loops', () => {
    const fig8 = curvesOf([anchor(0, 0), anchor(10, 10), anchor(10, 0), anchor(0, 10)], true, 'a');
    const map = buildPlanarMap(fig8);
    expect(areas(map)).toEqual([25, 25]);
  });

  it('samples interior points spread over a face', () => {
    const map = buildPlanarMap(curvesOf(rectangle(0, 0, 100, 20), true, 'a'));
    const pts = interiorPoints(map.faces[0].polys, map.faces[0].bounds, 5, 3);
    expect(pts).toHaveLength(16);
    // Spread across the width, not just down the middle.
    expect(Math.min(...pts.map((p) => p[0]))).toBeLessThan(25);
    expect(Math.max(...pts.map((p) => p[0]))).toBeGreaterThan(75);
    for (const [x, y] of pts) expect(pointInPolys(map.faces[0].polys, x, y)).toBe(true);
  });

  it('handles many crossing lines', () => {
    const curves = [];
    for (let i = 0; i < 6; i++) curves.push(...line(i * 10, -5, i * 10, 55, `v${i}`), ...line(-5, i * 10, 55, i * 10, `h${i}`));
    const map = buildPlanarMap(curves);
    expect(map.faces).toHaveLength(25);
    for (const f of map.faces) expect(f.area).toBeCloseTo(100);
  });
});
