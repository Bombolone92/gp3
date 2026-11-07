import { describe, expect, it } from 'vitest';
import {
  about,
  affineFromParams,
  anchorOffset,
  automaticMethod,
  compose,
  distortQuad,
  dragBezierSurface,
  exactQuarterTurn,
  flip,
  fromPixels,
  imageBytes,
  inscribedSize,
  isParallelogram,
  isRotatedRect,
  mapQuad,
  meshDragGroup,
  paramsFromAffine,
  perspectiveQuad,
  quadAffine,
  quadTransform,
  quadValid,
  quarterTurns,
  rectQuad,
  rectifiedSize,
  rotate90,
  rotateM,
  rotatedCanvasSize,
  samplerInterp,
  scaleM,
  scaleQuad,
  skewQuad,
  straightenAngle,
  toPixels,
  transformQuad,
  translate,
  frameMatrix,
} from '../src/features/transform/math';
import { applyMat3, homography } from '../src/imaging/filters/warp';
import { evalMesh, identityGrid } from '../src/imaging/filters/mesh';
import type { RGBA8 } from '../src/imaging/types';

const close = (a: number, b: number, eps = 1e-7) => expect(Math.abs(a - b)).toBeLessThan(eps);
function numbered(w: number, h: number): RGBA8 {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set([i % 256, (i >> 8) & 255, 7, 255], i * 4);
  return { width: w, height: h, data };
}
const px = (img: RGBA8, x: number, y: number) => [...img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4)];

describe('matrix composition', () => {
  it('composes right to left and rotates clockwise on screen', () => {
    const m = compose(translate(10, 0), rotateM(90));
    const p = applyMat3(m, 1, 0);
    close(p.x, 10);
    close(p.y, 1);
    const q = applyMat3(about(rotateM(180), 5, 5), 0, 0);
    close(q.x, 10);
    close(q.y, 10);
  });
  it('round-trips affine parameters through the QR decomposition', () => {
    const r = { x: 10, y: 20, width: 100, height: 50 };
    const ref = { x: 0.5, y: 0.5 };
    const p = { x: 70, y: 40, sx: 1.5, sy: 0.75, rotation: 30, skewX: 12, skewY: 0 };
    const m = affineFromParams(r, ref, p);
    const back = paramsFromAffine(m, r, ref);
    for (const k of Object.keys(p) as (keyof typeof p)[]) close(back[k], p[k], 1e-9);
    // The reference point lands at (x, y).
    const c = applyMat3(m, 60, 45);
    close(c.x, 70);
    close(c.y, 40);
  });
  it('folds vertical skew into rotation and horizontal skew without changing the matrix', () => {
    const r = { x: 0, y: 0, width: 10, height: 10 };
    const m = affineFromParams(r, { x: 0, y: 0 }, { x: 0, y: 0, sx: 1, sy: 1, rotation: 0, skewX: 0, skewY: 20 });
    const p = paramsFromAffine(m, r, { x: 0, y: 0 });
    const m2 = affineFromParams(r, { x: 0, y: 0 }, p);
    m.forEach((v, i) => close(v, m2[i], 1e-9));
  });
  it('recovers the affine map of a parallelogram quad', () => {
    const r = { x: 0, y: 0, width: 4, height: 2 };
    const m = compose(translate(3, 1), rotateM(25), scaleM(2, 3));
    const q = mapQuad(m, rectQuad(r));
    expect(isParallelogram(q)).toBe(true);
    quadAffine(r, q).forEach((v, i) => close(v, m[i], 1e-9));
    expect(isRotatedRect(q)).toBe(true);
    const t = quadTransform(q);
    close(t.rotation, 25);
    close(t.width, 8);
    close(t.height, 6);
    transformQuad(t).forEach((p, i) => (close(p.x, q[i].x, 1e-9), close(p.y, q[i].y, 1e-9)));
  });
  it('builds the similarity between two layer frames', () => {
    const a = { x: 0, y: 0, width: 10, height: 10, rotation: 0 };
    const b = { x: 20, y: 0, width: 20, height: 20, rotation: 90 };
    const m = frameMatrix(a, b);
    const p = applyMat3(m, 0, 0); // top-left of a → top-right of b after a 90° turn
    close(p.x, 40);
    close(p.y, 0);
  });
});

describe('quad edits', () => {
  const r = { x: 0, y: 0, width: 100, height: 50 };
  const q = rectQuad(r);
  it('scales from a corner with the opposite corner fixed', () => {
    const s = scaleQuad(r, q, 'se', { x: 100, y: 50 }, { x: 150, y: 60 }, true);
    close(s[0].x, 0, 1e-9);
    close(s[0].y, 0, 1e-9);
    close(s[2].x, 150, 1e-9);
    close(s[2].y, 75, 1e-9);
    const free = scaleQuad(r, q, 'se', { x: 100, y: 50 }, { x: 150, y: 60 }, false);
    close(free[2].x, 150);
    close(free[2].y, 60);
    const edge = scaleQuad(r, q, 'e', { x: 100, y: 25 }, { x: 120, y: 90 }, false);
    close(edge[2].x, 120);
    close(edge[2].y, 50);
  });
  it('scales about the reference point with Alt', () => {
    const s = scaleQuad(r, q, 'se', { x: 100, y: 50 }, { x: 150, y: 75 }, false, { x: 0.5, y: 0.5 });
    close(s[0].x, -50);
    close(s[0].y, -25);
    close(s[2].x, 150);
  });
  it('skews an edge along itself, keeping a parallelogram', () => {
    const s = skewQuad(q, 'n', { x: 20, y: 30 });
    expect(isParallelogram(s)).toBe(true);
    close(s[0].x, 20);
    close(s[0].y, 0);
    close(s[1].x, 120);
    expect(s[2]).toEqual(q[2]);
  });
  it('distorts a single corner and perspective moves partners symmetrically', () => {
    const d = distortQuad(q, 'ne', { x: 5, y: -7 });
    expect(d[1]).toEqual({ x: 105, y: -7 });
    expect(d[0]).toEqual(q[0]);
    const p = perspectiveQuad(q, 'ne', { x: 10, y: 1 });
    close(p[1].x, 110);
    close(p[0].x, -10);
    expect(p[2]).toEqual(q[2]);
    const v = perspectiveQuad(q, 'ne', { x: 1, y: -10 });
    close(v[1].y, -10);
    close(v[2].y, 60);
  });
  it('rejects collapsed or folded quads', () => {
    expect(quadValid(q)).toBe(true);
    expect(quadValid([q[0], q[1], q[1], q[3]])).toBe(false);
    expect(quadValid([q[0], q[2], q[1], q[3]])).toBe(false);
    // Mirrored (consistently clockwise the other way) stays valid.
    expect(quadValid(mapQuad(scaleM(-1, 1), q))).toBe(true);
  });
});

describe('mesh helpers', () => {
  it('drags the surface point exactly under the pointer', () => {
    const g = identityGrid({ x: 0, y: 0, width: 90, height: 90 }, 4, 4, 'bezier');
    const before = evalMesh(g, 0.4, 0.7);
    const moved = dragBezierSurface(g, 0.4, 0.7, { x: 10, y: -5 });
    const after = evalMesh(moved, 0.4, 0.7);
    close(after[0], before[0] + 10, 1e-9);
    close(after[1], before[1] - 5, 1e-9);
  });
  it('groups a corner anchor with its handles', () => {
    const g = identityGrid({ x: 0, y: 0, width: 9, height: 9 }, 4, 4, 'bezier');
    expect(meshDragGroup(g, 0).sort((a, b) => a - b)).toEqual([0, 1, 4, 5]);
    expect(meshDragGroup(g, 5)).toEqual([5]);
    const smooth = identityGrid({ x: 0, y: 0, width: 9, height: 9 }, 5, 5, 'smooth');
    expect(meshDragGroup(smooth, 0)).toEqual([0]);
  });
});

describe('exact rotations', () => {
  it('rotates quarter turns without resampling and round-trips', () => {
    const img = numbered(3, 2);
    const cw = rotate90(img, 1);
    expect([cw.width, cw.height]).toEqual([2, 3]);
    // Top-left goes to top-right on a clockwise turn.
    expect(px(cw, 1, 0)).toEqual(px(img, 0, 0));
    expect(px(cw, 0, 0)).toEqual(px(img, 0, 1));
    const back = rotate90(rotate90(rotate90(cw, 1), 1), 1);
    expect([...back.data]).toEqual([...img.data]);
    const half = rotate90(img, 2);
    expect(px(half, 0, 0)).toEqual(px(img, 2, 1));
    expect([...rotate90(img, -1).data]).toEqual([...rotate90(img, 3).data]);
  });
  it('rotates masks and handles 1x1 and odd sizes', () => {
    const m = { width: 1, height: 1, data: new Uint8Array([200]) };
    expect([...rotate90(m, 1).data]).toEqual([200]);
    const odd = { width: 3, height: 1, data: new Uint8Array([1, 2, 3]) };
    const r = rotate90(odd, 1);
    expect([r.width, r.height]).toEqual([1, 3]);
    expect([...r.data]).toEqual([1, 2, 3]);
    expect([...rotate90(odd, 3).data]).toEqual([3, 2, 1]);
  });
  it('flips and keeps transparent pixels untouched', () => {
    const img = numbered(2, 2);
    img.data[3] = 0;
    const h = flip(img, true);
    expect(px(h, 1, 0)).toEqual(px(img, 0, 0));
    const v = flip(img, false);
    expect(px(v, 0, 1)).toEqual(px(img, 0, 0));
  });
  it('detects transforms that are exact quarter turns', () => {
    expect(quarterTurns(270)).toBe(3);
    expect(quarterTurns(-90)).toBe(3);
    expect(quarterTurns(45)).toBeNull();
    const b = { x: 2, y: 3, width: 4, height: 2 };
    expect(exactQuarterTurn({ ...b, rotation: 90 }, b)).toBe(1);
    // Odd/even size difference lands on half pixels: not exact.
    expect(exactQuarterTurn({ x: 2, y: 3, width: 3, height: 2, rotation: 90 }, { x: 2, y: 3, width: 3, height: 2 })).toBeNull();
    expect(exactQuarterTurn({ ...b, width: 5, rotation: 90 }, b)).toBeNull();
    expect(exactQuarterTurn({ ...b, rotation: 180 }, b)).toBe(2);
  });
});

describe('units and sizes', () => {
  it('converts lengths at a resolution', () => {
    close(toPixels(1, 'in', 300, 0), 300);
    close(toPixels(2.54, 'cm', 300, 0), 300);
    close(toPixels(25.4, 'mm', 72, 0), 72);
    close(toPixels(72, 'pt', 144, 0), 144);
    close(toPixels(50, 'percent', 72, 1000), 500);
    for (const u of ['px', 'in', 'cm', 'mm', 'pt', 'percent'] as const) close(fromPixels(toPixels(3.5, u, 240, 800), u, 240, 800), 3.5, 1e-9);
  });
  it('reports image bytes and the automatic method', () => {
    expect(imageBytes(100, 100)).toBe(30000);
    expect(imageBytes(100, 100, 16)).toBe(60000);
    expect(automaticMethod(100, 100, 200, 200)).toBe('bicubic-smoother');
    expect(automaticMethod(100, 100, 50, 50)).toBe('bicubic-sharper');
    expect(samplerInterp('bicubic-smoother')).toBe('mitchell');
    expect(samplerInterp(undefined)).toBe('bicubic');
  });
  it('places the old canvas by anchor', () => {
    expect(anchorOffset(100, 50, 200, 100, 0, 0)).toEqual({ dx: 0, dy: 0 });
    expect(anchorOffset(100, 50, 200, 100, 0.5, 0.5)).toEqual({ dx: 50, dy: 25 });
    expect(anchorOffset(100, 50, 200, 100, 1, 1)).toEqual({ dx: 100, dy: 50 });
    expect(anchorOffset(100, 50, 60, 50, 1, 0.5)).toEqual({ dx: -40, dy: 0 });
  });
  it('sizes rotated canvases and inscribed crops', () => {
    expect(rotatedCanvasSize(100, 50, 90)).toEqual({ width: 50, height: 100 });
    expect(rotatedCanvasSize(100, 50, 180)).toEqual({ width: 100, height: 50 });
    const s = rotatedCanvasSize(100, 100, 45);
    expect(s.width).toBe(Math.ceil(100 * Math.SQRT2));
    const i = inscribedSize(100, 100, 45, 1);
    close(i.width, 100 / Math.SQRT2, 1e-9);
    const z = inscribedSize(300, 200, 0);
    close(z.width, 300);
    close(z.height, 200);
  });
  it('levels drawn lines to the nearest axis', () => {
    close(straightenAngle({ x: 0, y: 0 }, { x: 100, y: 10 }), (-Math.atan2(10, 100) * 180) / Math.PI);
    close(straightenAngle({ x: 0, y: 0 }, { x: 5, y: 100 }), 90 - (Math.atan2(100, 5) * 180) / Math.PI);
    close(straightenAngle({ x: 100, y: 0 }, { x: 0, y: 10 }), (Math.atan2(10, 100) * 180) / Math.PI);
  });
  it('sizes perspective crops from the longer opposite sides', () => {
    const q = [{ x: 0, y: 0 }, { x: 100, y: 10 }, { x: 90, y: 60 }, { x: 5, y: 50 }] as [any, any, any, any];
    const s = rectifiedSize(q);
    expect(s.width).toBe(Math.round(Math.hypot(100, 10)));
    expect(s.height).toBe(Math.round(Math.max(Math.hypot(5, 50), Math.hypot(10, 50))));
    // The homography maps the quad corners onto the output rectangle.
    const h = homography(q, [{ x: 0, y: 0 }, { x: s.width, y: 0 }, { x: s.width, y: s.height }, { x: 0, y: s.height }]);
    const c = applyMat3(h, 90, 60);
    close(c.x, s.width, 1e-6);
    close(c.y, s.height, 1e-6);
  });
});
