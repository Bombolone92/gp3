import { describe, it, expect } from 'vitest';
import { pathBounds, split, pointAt, insertAnchor, nearestOnCubic, fitCurve, simplifyPolyline, signedArea, reverseAnchors, anchor } from '../src/model/bezier.js';
import { ellipse, rectangle, star, polygon } from '../src/model/shapes.js';

describe('bezier geometry', () => {
  it('computes tight bounds of a circle from its curve extrema', () => {
    const b = pathBounds(ellipse(10, 20, 100, 60), true);
    expect(b.x).toBeCloseTo(10, 6);
    expect(b.y).toBeCloseTo(20, 6);
    expect(b.w).toBeCloseTo(100, 6);
    expect(b.h).toBeCloseTo(60, 6);
  });

  it('splits a cubic without changing its shape', () => {
    const c = [0, 0, 10, 40, 60, 40, 70, 0];
    const [l, r] = split(c, 0.3);
    const p = pointAt(c, 0.3);
    expect(l[6]).toBeCloseTo(p.x);
    expect(r[0]).toBeCloseTo(p.x);
    expect(pointAt(l, 0.5).x).toBeCloseTo(pointAt(c, 0.15).x);
  });

  it('inserts an anchor that keeps the path shape', () => {
    const pts = ellipse(0, 0, 100, 100);
    const out = insertAnchor(pts, true, 0, 0.5);
    expect(out).toHaveLength(5);
    const b1 = pathBounds(pts, true);
    const b2 = pathBounds(out, true);
    expect(b2.w).toBeCloseTo(b1.w, 6);
    expect(b2.h).toBeCloseTo(b1.h, 6);
  });

  it('finds the nearest point on a curve', () => {
    const c = [0, 0, 0, 0, 100, 0, 100, 0];
    const r = nearestOnCubic(c, 50, 10);
    expect(r.x).toBeCloseTo(50, 3);
    expect(r.d).toBeCloseTo(10, 3);
  });

  it('fits few smooth curves to a dense polyline', () => {
    const pts = [];
    for (let i = 0; i <= 200; i++) {
      const a = (i / 200) * Math.PI;
      pts.push({ x: 100 * Math.cos(a), y: 100 * Math.sin(a) });
    }
    const anchors = fitCurve(simplifyPolyline(pts, 0.2), 1);
    expect(anchors.length).toBeLessThan(10);
    expect(anchors[0].x).toBeCloseTo(100);
    expect(anchors[anchors.length - 1].x).toBeCloseTo(-100);
  });

  it('reports orientation and reverses paths', () => {
    const r = rectangle(0, 0, 10, 10);
    const a = signedArea(r);
    expect(Math.abs(a)).toBeCloseTo(100);
    expect(signedArea(reverseAnchors(r))).toBeCloseTo(-a);
  });

  it('builds stars and polygons with the right anchor counts', () => {
    expect(star(0, 0, 50, 25, 5)).toHaveLength(10);
    expect(polygon(0, 0, 50, 6)).toHaveLength(6);
    expect(polygon(0, 0, 50, 6)[0].y).toBeCloseTo(-50);
  });

  it('rounds rectangle corners with two anchors per corner', () => {
    const r = rectangle(0, 0, 100, 50, 10);
    expect(r).toHaveLength(8);
    const b = pathBounds(r, true);
    expect(b.w).toBeCloseTo(100);
    expect(b.h).toBeCloseTo(50);
  });

  it('treats retracted handles as lines', () => {
    const a = anchor(1, 2);
    expect(a.ix).toBe(1);
    expect(a.oy).toBe(2);
  });
});
