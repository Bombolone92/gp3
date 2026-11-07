import { describe, it, expect } from 'vitest';
import { warpMapping, warpSubpaths, WARP_STYLES, normalizeWarp, isWarpStyle } from '../src/model/warp.js';
import { mapSubpaths } from '../src/model/point-map.js';
import { rectangle, ellipse } from '../src/model/shapes.js';
import { pathBounds, flattenPath, segmentCount, segmentPoints, pointAt, isLine } from '../src/model/bezier.js';

const box = { x: 100, y: 50, w: 200, h: 100 };
const rectSub = () => [{ anchors: rectangle(box.x, box.y, box.w, box.h), closed: true }];

/** Largest distance between the mapped source curve and the result, sampled densely. */
function maxDeviation(src, out, f) {
  // Compare: every flattened point of f(source) lies near the result outline.
  const res = flattenPath(out.anchors, out.closed, 0.01);
  let worst = 0;
  const n = segmentCount(src.anchors, src.closed);
  for (let i = 0; i < n; i++) {
    const c = segmentPoints(src.anchors, i);
    for (let k = 0; k <= 40; k++) {
      const p = pointAt(c, k / 40);
      const q = f(p.x, p.y);
      let best = Infinity;
      for (let j = 0; j < res.length - 1; j++) {
        const a = res[j];
        const b = res[j + 1];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const t = Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
        best = Math.min(best, Math.hypot(q.x - a.x - t * dx, q.y - a.y - t * dy));
      }
      worst = Math.max(worst, best);
    }
  }
  return worst;
}

describe('warp mapping', () => {
  it('lists fifteen styles with labels', () => {
    expect(WARP_STYLES).toHaveLength(15);
    for (const s of WARP_STYLES) {
      expect(isWarpStyle(s.id)).toBe(true);
      expect(s.label).toBeTruthy();
    }
  });

  it('normalizes parameters', () => {
    expect(normalizeWarp({ style: 'nope', bend: 7, distortH: -3, vertical: 1 })).toEqual({ style: 'arc', bend: 1, vertical: true, distortH: -1, distortV: 0 });
    expect(normalizeWarp({})).toEqual({ style: 'arc', bend: 0.5, vertical: false, distortH: 0, distortV: 0 });
  });

  it('is the identity with no bend and no distortion', () => {
    for (const s of WARP_STYLES) {
      const f = warpMapping(s.id, { bend: 0 }, box);
      for (const [x, y] of [[100, 50], [300, 150], [180, 120]]) {
        const p = f(x, y);
        expect(p.x).toBeCloseTo(x, 9);
        expect(p.y).toBeCloseTo(y, 9);
      }
    }
  });

  it('keeps the center fixed for symmetric styles', () => {
    for (const id of ['arc', 'bulge', 'flag', 'fisheye', 'inflate', 'squeeze', 'twist', 'shellLower', 'shellUpper']) {
      const f = warpMapping(id, { bend: 0.5 }, box);
      const p = f(200, 100);
      if (id === 'shellLower' || id === 'shellUpper') {
        expect(p.x).toBeCloseTo(200, 6);
        continue;
      }
      expect(p.x).toBeCloseTo(200, 6);
      expect(p.y).toBeCloseTo(100, 6);
    }
  });

  it('bends an arc: the middle of the top edge rises above the ends', () => {
    const f = warpMapping('arc', { bend: 0.5 }, box);
    const mid = f(200, 50);
    const left = f(100, 50);
    const right = f(300, 50);
    expect(mid.y).toBeLessThan(left.y);
    expect(left.y).toBeCloseTo(right.y, 6);
    // Mirror symmetric.
    expect(left.x - 200).toBeCloseTo(200 - right.x, 6);
    // Negative bend curves the other way.
    const g = warpMapping('arc', { bend: -0.5 }, box);
    expect(g(200, 50).y).toBeGreaterThan(g(100, 50).y);
  });

  it('keeps arc lower top edge straight and bows the bottom edge', () => {
    const f = warpMapping('arcLower', { bend: 0.5 }, box);
    expect(f(150, 50).y).toBeCloseTo(50, 9);
    expect(f(200, 150).y).toBeGreaterThan(150);
    expect(f(100, 150).y).toBeCloseTo(150, 9);
    const u = warpMapping('arcUpper', { bend: 0.5 }, box);
    expect(u(150, 150).y).toBeCloseTo(150, 9);
    expect(u(200, 50).y).toBeLessThan(50);
  });

  it('bends vertical styles along the height', () => {
    const f = warpMapping('arc', { bend: 0.5, vertical: true }, box);
    // The left edge's middle moves sideways, not up.
    const a = f(100, 100);
    const b = f(100, 50);
    expect(Math.abs(a.x - b.x)).toBeGreaterThan(1);
  });

  it('distorts like a perspective: horizontal makes the right side taller', () => {
    const f = warpMapping('arc', { bend: 0, distortH: 0.5 }, box);
    const rightH = f(300, 150).y - f(300, 50).y;
    const leftH = f(100, 150).y - f(100, 50).y;
    expect(rightH).toBeCloseTo(150, 6);
    expect(leftH).toBeCloseTo(50, 6);
    const g = warpMapping('arc', { bend: 0, distortV: 0.5 }, box);
    expect(g(300, 150).x - g(100, 150).x).toBeCloseTo(300, 6);
    expect(g(300, 50).x - g(100, 50).x).toBeCloseTo(100, 6);
  });

  it('every style moves something at 50% bend and stays finite', () => {
    for (const s of WARP_STYLES) {
      const f = warpMapping(s.id, { bend: 0.5 }, box);
      let moved = 0;
      for (let i = 0; i <= 10; i++) {
        for (let j = 0; j <= 10; j++) {
          const x = box.x + (box.w * i) / 10;
          const y = box.y + (box.h * j) / 10;
          const p = f(x, y);
          expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
          moved = Math.max(moved, Math.hypot(p.x - x, p.y - y));
        }
      }
      expect(moved, s.id).toBeGreaterThan(5);
    }
  });
});

describe('warping outlines', () => {
  it('returns the input untouched when nothing bends', () => {
    const subs = rectSub();
    expect(warpSubpaths(subs, 'arc', { bend: 0 }, box)).toBe(subs);
  });

  it('follows the point function within tolerance for every style', () => {
    for (const s of WARP_STYLES) {
      for (const bend of [0.5, -0.8]) {
        const f = warpMapping(s.id, { bend, distortH: 0.2 }, box);
        const src = rectSub()[0];
        const [out] = warpSubpaths([src], s.id, { bend, distortH: 0.2 }, box, { tolerance: 0.05 });
        expect(out.closed).toBe(true);
        expect(maxDeviation(src, out, f), `${s.id} ${bend}`).toBeLessThan(0.2);
      }
    }
  });

  it('turns straight edges into smooth curves with continuous tangents', () => {
    const [out] = warpSubpaths(rectSub(), 'arc', { bend: 0.5 }, box);
    expect(out.anchors.length).toBeGreaterThan(4);
    // Inside the top edge, anchors added by subdivision are smooth (handles collinear).
    const smooth = out.anchors.filter((a) => {
      const v1 = [a.x - a.ix, a.y - a.iy];
      const v2 = [a.ox - a.x, a.oy - a.y];
      const l1 = Math.hypot(...v1);
      const l2 = Math.hypot(...v2);
      return l1 > 1e-6 && l2 > 1e-6 && Math.abs(v1[0] * v2[1] - v1[1] * v2[0]) / (l1 * l2) < 1e-3;
    });
    expect(smooth.length).toBeGreaterThan(2);
  });

  it('keeps straight lines straight under an affine distortion', () => {
    const subs = [{ anchors: rectangle(0, 0, 10, 10), closed: true }];
    const out = mapSubpaths(subs, (x, y) => ({ x: 2 * x + y, y: y + 3 }));
    expect(out[0].anchors).toHaveLength(4);
    const n = segmentCount(out[0].anchors, true);
    for (let i = 0; i < n; i++) expect(isLine(segmentPoints(out[0].anchors, i))).toBe(true);
    expect(out[0].anchors[2]).toMatchObject({ x: 30, y: 13 });
  });

  it('maps open paths, their end handles and extra subpath fields', () => {
    const anchors = [
      { x: 0, y: 0, ix: -5, iy: 0, ox: 5, oy: 5 },
      { x: 20, y: 0, ix: 15, iy: 5, ox: 25, oy: 0 },
    ];
    const [out] = mapSubpaths([{ anchors, closed: false, paint: { fill: null } }], (x, y) => ({ x: x * 2, y: y * 2 }));
    expect(out.paint).toEqual({ fill: null });
    const near = (a, want) => {
      for (const [k, v] of Object.entries(want)) expect(a[k]).toBeCloseTo(v, 6);
    };
    near(out.anchors[0], { x: 0, y: 0, ix: -10, iy: 0, ox: 10, oy: 10 });
    near(out.anchors[1], { x: 40, y: 0, ix: 30, iy: 10, ox: 50, oy: 0 });
  });

  it('warps curved outlines (ellipse) smoothly and inside a sane box', () => {
    const subs = [{ anchors: ellipse(box.x, box.y, box.w, box.h), closed: true }];
    const [out] = warpSubpaths(subs, 'bulge', { bend: 0.5 }, box);
    const b = pathBounds(out.anchors, true);
    expect(b.h).toBeGreaterThan(box.h);
    expect(b.w).toBeCloseTo(box.w, 0);
  });
});
