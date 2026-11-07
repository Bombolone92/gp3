import { describe, expect, it } from 'vitest';
import { fitPath, nearestSegment, componentAt, closedPath, ellipseKnots, type Pt } from '../src/features/vector/geometry';

// Generous budgets: the machine running tests is shared and heavily loaded.
describe('path geometry performance', () => {
  it('fits a 20,000-point traced outline quickly', () => {
    const pts: Pt[] = [];
    // A pixel staircase of a large ellipse, as traced from a selection.
    for (let i = 0; i < 20000; i++) {
      const a = (i / 20000) * Math.PI * 2;
      pts.push([Math.round(2000 + Math.cos(a) * 1800), Math.round(1500 + Math.sin(a) * 1300)]);
    }
    const t0 = performance.now();
    const p = fitPath(pts, 2, true)!;
    const ms = performance.now() - t0;
    console.log(`fitPath 20k points: ${ms.toFixed(1)} ms, ${p.knots.length} knots`);
    expect(p.knots.length).toBeLessThan(60);
    expect(ms).toBeLessThan(1500);
  });
  it('hit tests a 400-knot path in well under a frame', () => {
    const paths = Array.from({ length: 100 }, (_, i) => closedPath(ellipseKnots((i % 10) * 100, Math.floor(i / 10) * 100, 80, 80)));
    const m = { paths };
    const t0 = performance.now();
    for (let i = 0; i < 100; i++) nearestSegment(m, 512 + i, 377);
    const near = (performance.now() - t0) / 100;
    const t1 = performance.now();
    for (let i = 0; i < 100; i++) componentAt(m, 512 + i, 377);
    const inside = (performance.now() - t1) / 100;
    console.log(`nearestSegment: ${near.toFixed(2)} ms, componentAt: ${inside.toFixed(2)} ms per call (400 cubic segments)`);
    expect(near).toBeLessThan(8);
    expect(inside).toBeLessThan(8);
  });
});
