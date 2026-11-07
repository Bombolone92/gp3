import { describe, expect, it } from 'vitest';
import {
  addPlane,
  convexQuad,
  emptyPlanes,
  perspectiveMap,
  planeAt,
  planeEdges,
  planeMaps,
  removePlane,
  snapPoint,
  straighten,
  straightenEdge,
  warpedBounds,
  type PlaneSet,
} from '../src/imaging/warp/perspective';
import { applyMat3, type Point } from '../src/imaging/filters/warp';

const rect = (x: number, y: number, w: number, h: number): Point[] => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];

describe('perspective planes layout', () => {
  it('shares corners of touching planes and cleans up on removal', () => {
    let set: PlaneSet = emptyPlanes();
    set = addPlane(set, rect(0, 0, 100, 100), 5);
    set = addPlane(set, rect(102, 2, 100, 96), 5);
    // The second plane's left corners snapped onto the first plane's right edge.
    expect(set.points).toHaveLength(6);
    expect(set.planes[1][0]).toBe(set.planes[0][1]);
    expect(set.planes[1][3]).toBe(set.planes[0][2]);
    // Shared edge appears once.
    expect(planeEdges(set.planes)).toHaveLength(7);
    expect(planeAt(set.points, set.planes, { x: 150, y: 50 })).toBe(1);
    expect(planeAt(set.points, set.planes, { x: 300, y: 50 })).toBe(-1);
    const one = removePlane(set, 0);
    expect(one.planes).toHaveLength(1);
    expect(one.points).toHaveLength(4);
  });
  it('merges a dragged corner into a nearby point unless it collapses a plane', () => {
    let set = addPlane(emptyPlanes(), rect(0, 0, 100, 100), 5);
    set = addPlane(set, rect(200, 0, 100, 100), 5);
    expect(set.points).toHaveLength(8);
    // Drag plane 1's top-left onto plane 0's top-right.
    const i = set.planes[1][0];
    set = { ...set, points: set.points.map((p, k) => (k === i ? { x: 103, y: 1 } : p)) };
    const r = snapPoint(set, i, 6);
    expect(r.set.points).toHaveLength(7);
    expect(r.set.planes[1][0]).toBe(r.set.planes[0][1]);
    // Snapping a corner onto another corner of the same plane is refused.
    const j = r.set.planes[0][0];
    const moved = { ...r.set, points: r.set.points.map((p, k) => (k === j ? { x: 99, y: 2 } : p)) };
    expect(snapPoint(moved, j, 6).set).toBe(moved);
  });
  it('validates convex quads', () => {
    expect(convexQuad(rect(0, 0, 10, 10))).toBe(true);
    expect(convexQuad([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 10 }])).toBe(false);
    expect(convexQuad(rect(0, 0, 0.5, 0.5))).toBe(false);
  });
});

describe('perspective planes warp', () => {
  it('maps each plane through its homography and blends continuously outside', () => {
    const set = addPlane(addPlane(emptyPlanes(), rect(0, 0, 100, 100), 5), rect(100, 0, 100, 100), 5);
    const warped = set.points.map((p) => ({ ...p }));
    // Squash the right plane's far edge, a perspective view of a wall.
    const [, tr, br] = set.planes[1].map((i) => i);
    warped[tr] = { x: 180, y: 20 };
    warped[br] = { x: 180, y: 80 };
    const maps = planeMaps(set.points, warped, set.planes);
    expect(maps).toHaveLength(2);
    const map = perspectiveMap(maps);
    const at = (x: number, y: number) => {
      const t = new Float64Array([x, y]);
      map(x, y, t);
      return { x: t[0], y: t[1] };
    };
    // Corners map back to their rest positions.
    const c = at(180, 20);
    expect(c.x).toBeCloseTo(200, 6);
    expect(c.y).toBeCloseTo(0, 6);
    // Inside the left (unchanged) plane the map is the identity.
    const p = at(40, 60);
    expect(p.x).toBeCloseTo(40, 6);
    expect(p.y).toBeCloseTo(60, 6);
    // Forward and inverse agree inside the warped plane.
    const f = applyMat3(maps[1].forward, 150, 50);
    const back = at(f.x, f.y);
    expect(back.x).toBeCloseTo(150, 6);
    expect(back.y).toBeCloseTo(50, 6);
    // Continuity across a plane border: just outside matches just inside.
    const inside = at(179.999, 50),
      outside = at(180.001, 50);
    expect(Math.hypot(inside.x - outside.x, inside.y - outside.y)).toBeLessThan(0.05);
    // Bounds cover the warped planes.
    const b = warpedBounds(maps, { x: 0, y: 0, width: 200, height: 100 });
    expect(b.x).toBeLessThanOrEqual(0);
    expect(b.x + b.width).toBeGreaterThanOrEqual(180);
  });
  it('straightens near-vertical and near-horizontal edges, keeping shared corners together', () => {
    const set = addPlane(addPlane(emptyPlanes(), rect(0, 0, 100, 100), 5), rect(100, 0, 100, 100), 5);
    // Lean every vertical edge a little and tilt the top edges.
    const leaned = set.points.map((p) => ({ x: p.x + (p.y ? 8 : 0), y: p.y + p.x * 0.05 }));
    const v = straighten(leaned, set.planes, 'vertical');
    for (const [a, b] of planeEdges(set.planes)) {
      const dx = Math.abs(v[a].x - v[b].x),
        dy = Math.abs(v[a].y - v[b].y);
      if (dy > dx) expect(dx).toBeCloseTo(0, 9);
    }
    const both = straighten(leaned, set.planes, 'both');
    for (const [a, b] of planeEdges(set.planes)) {
      const dx = Math.abs(both[a].x - both[b].x),
        dy = Math.abs(both[a].y - both[b].y);
      expect(Math.min(dx, dy)).toBeCloseTo(0, 9);
    }
    // Steep diagonals beyond the angle limit are left alone.
    const diag = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 160, y: 100 }, { x: 60, y: 100 }];
    const s = addPlane(emptyPlanes(), diag, 1);
    const out = straighten(s.points, s.planes, 'vertical');
    expect(out[1].x).toBe(100);
    const e = straightenEdge(s.points, 1, 2);
    expect(e[1].x).toBe(e[2].x);
  });
});
