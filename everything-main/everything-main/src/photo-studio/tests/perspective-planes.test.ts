import { describe, expect, it } from 'vitest';
import { rgba8, type RGBA8 } from '../src/imaging/types';
import {
  cloneMapping,
  dabFootprint,
  extendPlane,
  extendPlaneTo,
  imageToPlane,
  pasteIntoPlane,
  perspectiveStamp,
  planeCoords,
  planeDab,
  planeGrid,
  planeHomography,
  planeMetrics,
  planeToImage,
  validQuad,
  type Quad,
} from '../src/imaging/filters/perspective-planes';

// A floor-like trapezoid: far edge short, near edge long.
const trap: Quad = [
  [70, 20],
  [130, 20],
  [180, 110],
  [20, 110],
];
const inside = (q: Quad, x: number, y: number) => {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i],
      b = q[(i + 1) % 4];
    const z = (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
    if (Math.abs(z) < 1e-9) continue;
    if (sign && Math.sign(z) !== sign) return false;
    sign = Math.sign(z);
  }
  return true;
};

describe('plane homography', () => {
  it('maps the unit square corners exactly and round-trips', () => {
    const m = planeHomography(trap);
    const corners: [number, number][] = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ];
    corners.forEach(([u, v], i) => {
      const [x, y] = planeToImage(m, u, v);
      expect(x).toBeCloseTo(trap[i][0], 6);
      expect(y).toBeCloseTo(trap[i][1], 6);
    });
    for (const [x, y] of [[100, 60], [40, 100], [123.4, 33.3]]) {
      const [u, v] = imageToPlane(m, x, y);
      const [x2, y2] = planeToImage(m, u, v);
      expect(x2).toBeCloseTo(x, 6);
      expect(y2).toBeCloseTo(y, 6);
    }
    const [u, v] = planeCoords(trap, 100, 110);
    expect(u).toBeCloseTo(0.5, 6);
    expect(v).toBeCloseTo(1, 6);
  });

  it('validates quads', () => {
    expect(validQuad(trap)).toBe(true);
    expect(validQuad([trap[0], trap[2], trap[1], trap[3]])).toBe(false); // self-intersecting
    expect(validQuad([[0, 0], [10, 0], [20, 0], [0, 10]])).toBe(false); // collinear corners
    expect(validQuad([[0, 0], [0.5, 0], [0.5, 0.5], [0, 0.5]])).toBe(false); // too small
  });

  it('grids and extensions follow the perspective', () => {
    const lines = planeGrid(trap, 4);
    expect(lines.length).toBe(10);
    // The u = 0.5 line of a symmetric trapezoid is vertical through x = 100.
    expect(lines[2][0][0]).toBeCloseTo(100, 6);
    expect(lines[2][1][0]).toBeCloseTo(100, 6);
    // Perspective: the v = 0.5 line sits above the midpoint height (farther side is compressed).
    const mid = lines[5 + 2];
    expect(mid[0][1]).toBeLessThan(65);
    const ext = extendPlane(trap, 2, 0.5);
    expect(ext[0]).toEqual(trap[0]);
    expect(ext[2][1]).toBeGreaterThan(110);
    // Extending reaches a dragged point's plane line.
    const to = extendPlaneTo(trap, 1, 200, 60);
    const [u] = planeCoords(to, 200, 60);
    expect(u).toBeCloseTo(1, 6);
  });

  it('estimates the aspect of a rendered rectangle', () => {
    // Render a 2:1 rectangle on a plane tilted away from the camera.
    const f = 300,
      c: [number, number] = [160, 120];
    const tilt = 1.0;
    const project = (X: number, Y: number): [number, number] => {
      // Plane y = 1 (floor), points at depth Z; rotated about x by tilt.
      const y = Y * Math.cos(tilt) + 1.2,
        z = Y * Math.sin(tilt) + 4;
      return [c[0] + (f * X) / z, c[1] + (f * y) / z];
    };
    const q: Quad = [project(-1, 0.5), project(1, 0.5), project(1, -0.5), project(-1, -0.5)];
    const m = planeMetrics(q, { principal: c, focal: f });
    expect(m.aspect).toBeCloseTo(2, 1);
    // A frontal square needs no vanishing points.
    expect(planeMetrics([[0, 0], [40, 0], [40, 20], [0, 20]]).aspect).toBeCloseTo(2, 6);
  });
});

describe('clone, paste and dabs', () => {
  it('clone mapping is the identity when source and destination coincide', () => {
    const map = cloneMapping(trap, [100, 60], trap, [100, 60]);
    for (const [x, y] of [[100, 60], [90, 80], [130, 100]]) {
      const [sx, sy] = map(x, y);
      expect(sx).toBeCloseTo(x, 6);
      expect(sy).toBeCloseTo(y, 6);
    }
    // A pure offset within one plane keeps plane-coordinate offsets.
    const shift = cloneMapping(trap, [100, 40], trap, [100, 90]);
    const [u0, v0] = planeCoords(trap, 100, 90),
      [u1, v1] = planeCoords(trap, ...shift(100, 90));
    expect(u1 - u0).toBeCloseTo(0, 6);
    expect(v1).toBeLessThan(v0);
  });

  it('pastes a checker into a trapezoid without leaving the quad', () => {
    const src = rgba8(16, 16);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) src.data.set((x >> 2) % 2 === (y >> 2) % 2 ? [255, 0, 0, 255] : [0, 0, 255, 255], (y * 16 + x) * 4);
    const dst: RGBA8 = rgba8(200, 130);
    pasteIntoPlane(src, trap, dst, { opacity: 1, fit: 'fill' });
    let painted = 0,
      outside = 0;
    for (let y = 0; y < dst.height; y++)
      for (let x = 0; x < dst.width; x++) {
        const a = dst.data[(y * dst.width + x) * 4 + 3];
        if (!a) continue;
        painted++;
        // Only antialiased edge pixels may extend past the quad.
        if (!inside(trap, x + 0.5, y + 0.5) && !inside(trap, x, y) && !inside(trap, x + 1, y + 1) && !inside(trap, x + 1, y) && !inside(trap, x, y + 1)) outside++;
      }
    expect(outside).toBe(0);
    expect(painted).toBeGreaterThan(0.9 * ((60 + 160) / 2) * 90);
    // Interior pixels are opaque checker colors.
    const o = (60 * dst.width + 100) * 4;
    expect(dst.data[o + 3]).toBe(255);
    expect(dst.data[o] + dst.data[o + 2]).toBeGreaterThan(250);
  });

  it('dabs shrink toward the far edge', () => {
    const near = dabFootprint(trap, 100, 100, 20),
      far = dabFootprint(trap, 100, 25, 20);
    expect(near.rx).toBeGreaterThan(far.rx);
    expect(far.ry).toBeLessThan(far.rx); // foreshortened
    const square: Quad = [[0, 0], [100, 0], [100, 100], [0, 100]];
    const flat = dabFootprint(square, 50, 50, 20);
    expect(flat.rx).toBeCloseTo(10, 3);
    expect(flat.ry).toBeCloseTo(10, 3);
    const dab = planeDab(trap, 100, 100, 20);
    expect(dab.mask.data.some((v) => v === 255)).toBe(true);
  });

  it('stamps cloned pixels through a mapping', () => {
    const src = rgba8(40, 40);
    for (let i = 0; i < 40 * 40; i++) src.data.set([i % 40 < 20 ? 255 : 0, 0, 0, 255], i * 4);
    const dst = rgba8(40, 40, [0, 0, 255, 255]);
    const mask = { width: 5, height: 5, data: new Uint8Array(25).fill(255) };
    const n = perspectiveStamp(dst, src, (x, y) => [x - 20, y], mask, 25, 10);
    expect(n).toBe(25);
    expect([...dst.data.subarray((12 * 40 + 27) * 4, (12 * 40 + 27) * 4 + 4)]).toEqual([255, 0, 0, 255]);
  });
});
