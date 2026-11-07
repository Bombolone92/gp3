import { describe, expect, it } from 'vitest';
import { evalMesh, meshKnots, warpPreset } from '../src/imaging/filters/mesh';
import { convertibleAnchor, handlePartner, removeSplit, splitMesh } from '../src/features/transform/math';

const rect = { x: 10, y: 20, width: 300, height: 200 };
function sameSurface(a: Parameters<typeof evalMesh>[0], b: Parameters<typeof evalMesh>[0]) {
  const p = new Float64Array(2),
    q = new Float64Array(2);
  for (let j = 0; j <= 12; j++)
    for (let i = 0; i <= 12; i++) {
      evalMesh(a, i / 12, j / 12, p);
      evalMesh(b, i / 12, j / 12, q);
      expect(q[0]).toBeCloseTo(p[0], 6);
      expect(q[1]).toBeCloseTo(p[1], 6);
    }
}

describe('warp splits', () => {
  const base = warpPreset('wave', 0.6, 0.2, -0.1, rect);

  it('splitting keeps the surface and its mapping of the source', () => {
    const h = splitMesh(base, 'v', 0.3)!;
    expect([h.cols, h.rows]).toEqual([4, 7]);
    expect(meshKnots(h, 'v')).toEqual([0, 0.3, 1]);
    sameSurface(base, h);
    const both = splitMesh(splitMesh(h, 'u', 0.7)!, 'v', 0.8)!;
    expect([both.cols, both.rows]).toEqual([7, 10]);
    expect(meshKnots(both, 'u')).toEqual([0, 0.7, 1]);
    expect(meshKnots(both, 'v')).toEqual([0, 0.3, 0.8, 1]);
    sameSurface(base, both);
    // The new split line's anchors lie on the surface at that position.
    for (const [col, u] of [[0, 0], [3, 1]]) {
      const p = evalMesh(base, u, 0.3);
      expect(h.points[(3 * h.cols + col) * 2]).toBeCloseTo(p[0], 6);
      expect(h.points[(3 * h.cols + col) * 2 + 1]).toBeCloseTo(p[1], 6);
    }
  });

  it('refuses splits on an existing line and undoes splits exactly', () => {
    const h = splitMesh(base, 'v', 0.3)!;
    expect(splitMesh(h, 'v', 0.3)).toBeUndefined();
    expect(splitMesh(base, 'u', 0)).toBeUndefined();
    const back = removeSplit(h, 'v', 1)!;
    expect([back.cols, back.rows]).toEqual([4, 4]);
    for (let i = 0; i < base.points.length; i++) expect(back.points[i]).toBeCloseTo(base.points[i], 6);
    expect(removeSplit(base, 'v', 1)).toBeUndefined();
  });

  it('pairs handles across split anchors', () => {
    const h = splitMesh(base, 'u', 0.5)!; // 7 x 4
    const C = h.cols;
    // Handle right of the split anchor (3, 0) pairs with the one on its left.
    expect(handlePartner(h, 0 * C + 4)).toEqual({ anchor: 3, opposite: 2 });
    expect(handlePartner(h, 0 * C + 2)).toEqual({ anchor: 3, opposite: 4 });
    // Edge anchors have a single handle in each direction.
    expect(handlePartner(h, 1)).toEqual({ anchor: 0, opposite: undefined });
    expect(handlePartner(h, 3)).toBeUndefined();
    expect(convertibleAnchor(h, 3)).toBe(true);
    expect(convertibleAnchor(h, 0)).toBe(false);
    expect(convertibleAnchor(base, 3)).toBe(false);
  });
});
