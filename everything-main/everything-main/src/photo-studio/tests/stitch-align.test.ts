import { describe, expect, it } from 'vitest';
import { applyMat3, mat3Invert, transformImage, type Mat3 } from '../src/imaging/filters/warp';
import { detectFeatures, grayOf, matchFeatures } from '../src/imaging/stitch/features';
import { fitModel, ransac, type Pair } from '../src/imaging/stitch/estimate';
import { alignImages, focalFromHomography, fromCylinder, placementBounds, placementForward, placementInverse, toCylinder } from '../src/imaging/stitch/align';
import { crop, scene } from './stitch-fixtures';

const cornerError = (a: Mat3, b: Mat3, w: number, h: number) =>
  Math.max(
    ...[
      [0, 0],
      [w, 0],
      [w, h],
      [0, h],
    ].map(([x, y]) => {
      const p = applyMat3(a, x, y),
        q = applyMat3(b, x, y);
      return Math.hypot(p.x - q.x, p.y - q.y);
    }),
  );

describe('model fitting', () => {
  it('recovers exact models from noiseless correspondences', () => {
    const H: Mat3 = [1.05, 0.08, 12, -0.04, 0.97, -7, 0.0002, -0.0001, 1];
    const pairs: Pair[] = [];
    for (let i = 0; i < 30; i++) {
      const a = { x: (i * 37) % 300, y: (i * 53) % 200 };
      pairs.push({ a, b: applyMat3(H, a.x, a.y) });
    }
    expect(cornerError(fitModel('homography', pairs)!, H, 300, 200)).toBeLessThan(1e-6);
    const S: Mat3 = [0.9, -0.2, 5, 0.2, 0.9, -3, 0, 0, 1];
    const sp = pairs.map((p) => ({ a: p.a, b: applyMat3(S, p.a.x, p.a.y) }));
    expect(cornerError(fitModel('similarity', sp)!, S, 300, 200)).toBeLessThan(1e-6);
    expect(cornerError(fitModel('affine', sp)!, S, 300, 200)).toBeLessThan(1e-6);
  });

  it('rejects outliers with RANSAC', () => {
    const T: Mat3 = [1, 0, 20, 0, 1, -11, 0, 0, 1];
    const pairs: Pair[] = [];
    for (let i = 0; i < 60; i++) {
      const a = { x: (i * 41) % 320, y: (i * 29) % 240 };
      const outlier = i % 4 === 0;
      pairs.push({ a, b: outlier ? { x: (i * 97) % 320, y: (i * 13) % 240 } : applyMat3(T, a.x + (i % 3) * 0.1, a.y) });
    }
    const fit = ransac('homography', pairs, { threshold: 2 })!;
    expect(fit.inliers.length).toBeGreaterThanOrEqual(45);
    expect(cornerError(fit.m, T, 320, 240)).toBeLessThan(1);
  });
});

describe('features', () => {
  it('matches corners between shifted crops', () => {
    const big = scene(420, 320);
    const a = crop(big, 0, 0, 320, 240),
      b = crop(big, 60, 40, 320, 240);
    const fa = detectFeatures(grayOf(a)),
      fb = detectFeatures(grayOf(b));
    expect(fa.points.length).toBeGreaterThan(100);
    const matches = matchFeatures(fa, fb);
    const good = matches.filter((m) => Math.hypot(fa.points[m.a].x - 60 - fb.points[m.b].x, fa.points[m.a].y - 40 - fb.points[m.b].y) < 2);
    expect(good.length).toBeGreaterThan(30);
    expect(good.length / matches.length).toBeGreaterThan(0.6);
  });
});

describe('alignImages', () => {
  it('recovers a known homography between two images', () => {
    const a = scene(360, 270, 5);
    const H: Mat3 = [0.96, 0.05, 14, -0.03, 1.02, 9, 0.00012, -0.00008, 1];
    const b = transformImage(a, H, { x: 0, y: 0, width: 360, height: 270 }, 'bicubic');
    const r = alignImages([a, b], { projection: 'perspective', reference: 0 });
    expect(r.aligned).toEqual([true, true]);
    // Placement of b maps its pixels back into a's frame: the inverse of H.
    const inv = mat3Invert(H)!;
    expect(r.placements[1].kind).toBe('matrix');
    expect(cornerError((r.placements[1] as { m: Mat3 }).m, inv, 360, 270)).toBeLessThan(1.5);
  });

  it('repositions shifted and rotated layers with a rigid model', () => {
    const big = scene(400, 320, 9);
    const a = crop(big, 20, 20, 340, 260);
    const R: Mat3 = [Math.cos(0.05), -Math.sin(0.05), 18, Math.sin(0.05), Math.cos(0.05), -10, 0, 0, 1];
    const b = transformImage(a, R, { x: 0, y: 0, width: 340, height: 260 }, 'bicubic');
    const r = alignImages([a, b], { projection: 'reposition', reference: 0 });
    expect(r.projection).toBe('reposition');
    expect(cornerError((r.placements[1] as { m: Mat3 }).m, mat3Invert(R)!, 340, 260)).toBeLessThan(1.5);
  });

  it('chooses a similarity for near-similar layers in auto mode', () => {
    const a = scene(320, 240, 2);
    const b = transformImage(a, [1, 0, 7, 0, 1, -5, 0, 0, 1], { x: 0, y: 0, width: 320, height: 240 }, 'bilinear');
    const r = alignImages([a, b], { reference: 0 });
    expect(r.projection).toBe('similarity');
    const m = (r.placements[1] as { m: Mat3 }).m;
    expect(m[2]).toBeCloseTo(-7, 0);
    expect(m[5]).toBeCloseTo(5, 0);
  });
});

describe('cylindrical projection', () => {
  it('round-trips points and estimates focal length from a rotation', () => {
    const c = { x: 160, y: 120 };
    const p = toCylinder(250, 40, 300, c);
    const q = fromCylinder(p.x, p.y, 300, c)!;
    expect(q.x).toBeCloseTo(250, 6);
    expect(q.y).toBeCloseTo(40, 6);
    // H = K R K^-1 for a pan of 0.3 rad with f = 400.
    const f = 400,
      t = 0.3;
    const H: Mat3 = [Math.cos(t), 0, f * Math.sin(t), 0, 1, 0, -Math.sin(t) / f, 0, Math.cos(t)];
    expect(focalFromHomography(H)!).toBeCloseTo(400, 0);
  });

  it('maps placements forward and back', () => {
    const pl = { kind: 'cylinder' as const, f: 350, cx: 100, cy: 80, m: [1, 0, 30, 0, 1, 5, 0, 0, 1] as Mat3 };
    const fwd = placementForward(pl),
      inv = placementInverse(pl);
    const o = fwd(150, 20);
    const back = inv(o.x, o.y)!;
    expect(back.x).toBeCloseTo(150, 5);
    expect(back.y).toBeCloseTo(20, 5);
    const b = placementBounds(pl, { x: 0, y: 0, width: 200, height: 160 });
    expect(b.x).toBeGreaterThan(25);
    expect(b.width).toBeLessThan(200);
  });
});
