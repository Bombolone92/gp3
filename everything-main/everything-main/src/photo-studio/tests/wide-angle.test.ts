import { describe, expect, it } from 'vitest';
import { rgba8, type RGBA8 } from '../src/imaging/types';
import {
  applyWideAngle,
  fitConstraintArc,
  focalLengthToPixels,
  imageToSphere,
  sanitizeWideAngleParams,
  solveWideAngle,
  sphereToImage,
  type Camera,
  type Vec2,
} from '../src/imaging/filters/wide-angle';

function pattern(w: number, h: number): RGBA8 {
  const out = rgba8(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) out.data.set([(x * 9) & 255, (y * 17) & 255, ((x + y) * 5) & 255, 255], (y * w + x) * 4);
  return out;
}

// White image with a dark polyline of the given half-width.
function drawCurve(w: number, h: number, pts: Vec2[], half = 1.2): RGBA8 {
  const out = rgba8(w, h, [255, 255, 255, 255]);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const px = x + 0.5,
        py = y + 0.5;
      let best = Infinity;
      for (let k = 1; k < pts.length; k++) {
        const [ax, ay] = pts[k - 1],
          [bx, by] = pts[k];
        const dx = bx - ax,
          dy = by - ay,
          l2 = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
        best = Math.min(best, Math.hypot(px - ax - t * dx, py - ay - t * dy));
      }
      if (best < half) out.data.set([0, 0, 0, 255], (y * w + x) * 4);
    }
  return out;
}

// Largest distance of dark pixels from their best-fit (total least squares) line.
function straightness(img: RGBA8): { deviation: number; count: number } {
  const xs: number[] = [],
    ys: number[] = [];
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < img.width; x++) {
      const i = (y * img.width + x) * 4;
      if (img.data[i + 3] > 200 && img.data[i] < 100) {
        xs.push(x + 0.5);
        ys.push(y + 0.5);
      }
    }
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n,
    my = ys.reduce((a, b) => a + b, 0) / n;
  let sxx = 0,
    syy = 0,
    sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
    sxy += (xs[i] - mx) * (ys[i] - my);
  }
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const nx = -Math.sin(theta),
    ny = Math.cos(theta);
  let dev = 0;
  for (let i = 0; i < n; i++) dev = Math.max(dev, Math.abs((xs[i] - mx) * nx + (ys[i] - my) * ny));
  return { deviation: dev, count: n };
}

describe('wide angle camera models', () => {
  const W = 200,
    H = 150;
  for (const model of ['fisheye', 'perspective', 'spherical'] as const) {
    it(`${model}: image -> sphere -> image round-trips`, () => {
      const cam: Camera = { model, width: W, height: H, focalPx: focalLengthToPixels(16, 1, W, H) };
      for (const [x, y] of [[100, 75], [10, 20], [190, 140], [55, 110]] as Vec2[]) {
        const [u, v] = sphereToImage(cam, imageToSphere(cam, x, y));
        expect(u).toBeCloseTo(x, 6);
        expect(v).toBeCloseTo(y, 6);
      }
    });
  }
  it('arcs are straight under the rectilinear model and curved under fisheye', () => {
    const f = focalLengthToPixels(16, 1, W, H);
    const line = fitConstraintArc({ model: 'perspective', width: W, height: H, focalPx: f }, [20, 30], [180, 40], 9);
    for (const [x, y] of line) expect(Math.abs((y - 30) * 160 - (x - 20) * 10)).toBeLessThan(1e-6 * 160 + 1e-3);
    const arc = fitConstraintArc({ model: 'fisheye', width: W, height: H, focalPx: f }, [20, 30], [180, 30], 9);
    expect(arc[0]).toEqual([20, 30]);
    expect(arc[8]).toEqual([180, 30]);
    // The midpoint of a great circle above the center bows toward the edge.
    expect(arc[4][1]).toBeLessThan(29);
  });
});

// The solver runs real meshes; allow for loaded CI machines.
describe('wide angle solve and render', { timeout: 30_000 }, () => {
  it('rectilinear model with no constraints at 100% leaves the image unchanged', () => {
    const src = pattern(96, 64);
    const out = applyWideAngle(src, { model: 'perspective', focalLength: 20, cropFactor: 1, scale: 100, constraints: [] });
    let m = 0;
    for (let i = 0; i < src.data.length; i++) m = Math.max(m, Math.abs(out.data[i] - src.data[i]));
    expect(m).toBeLessThanOrEqual(1);
  });

  it('straightens a fisheye-bent line marked by a constraint', () => {
    const W = 200,
      H = 150;
    const params = { model: 'fisheye' as const, focalLength: 16, cropFactor: 1, scale: 100 };
    const cam: Camera = { model: 'fisheye', width: W, height: H, focalPx: focalLengthToPixels(16, 1, W, H) };
    // A straight world line above the optical axis, seen through the lens.
    const world: Vec2[] = [];
    for (let i = 0; i <= 80; i++) {
      const t = -1.5 + (3 * i) / 80;
      world.push(sphereToImage(cam, [t, -0.55, 1]));
    }
    const a = world[0],
      b = world[world.length - 1];
    for (const p of [a, b]) {
      expect(p[0]).toBeGreaterThan(5);
      expect(p[0]).toBeLessThan(W - 5);
    }
    const src = drawCurve(W, H, world);
    const before = straightness(src);
    expect(before.deviation).toBeGreaterThan(8);
    const out = applyWideAngle(src, { ...params, constraints: [{ a: [a[0] / W, a[1] / H], b: [b[0] / W, b[1] / H], orient: 'any' }] });
    const after = straightness(out);
    expect(after.count).toBeGreaterThan(before.count * 0.5);
    expect(after.deviation).toBeLessThan(before.deviation / 3);
    expect(after.deviation).toBeLessThan(3.5);
    // A horizontal constraint also levels the line.
    const level = applyWideAngle(src, { ...params, constraints: [{ a: [a[0] / W, a[1] / H], b: [b[0] / W, b[1] / H], orient: 'horizontal' }] });
    expect(straightness(level).deviation).toBeLessThan(3.5);
  });

  it('is deterministic', () => {
    const src = pattern(80, 60);
    const p = { model: 'fisheye' as const, focalLength: 14, cropFactor: 1, scale: 95, constraints: [{ a: [0.1, 0.2] as Vec2, b: [0.9, 0.25] as Vec2 }] };
    const x = applyWideAngle(src, p),
      y = applyWideAngle(src, p);
    expect(Buffer.from(x.data).equals(Buffer.from(y.data))).toBe(true);
  });

  it('keeps the mesh topology and scales about the center', () => {
    const m = solveWideAngle({ width: 120, height: 80, model: 'perspective', focalPx: 100, scale: 50, constraints: [], cols: 12 });
    expect(m.cols).toBe(12);
    expect(m.rows).toBe(8);
    expect(m.dst.length).toBe(13 * 9 * 2);
    expect(m.dst[0]).toBeCloseTo(30);
    expect(m.dst[1]).toBeCloseTo(20);
  });

  it('sanitizes untrusted settings', () => {
    const p = sanitizeWideAngleParams({ model: 'bogus' as never, focalLength: -5, scale: 999, constraints: [{ a: [2, -1], b: [0.5, 0.5], orient: 'up' as never }, { a: [NaN, 0] as never, b: [0, 0] }] });
    expect(p.model).toBe('fisheye');
    expect(p.focalLength).toBe(1);
    expect(p.scale).toBe(150);
    expect(p.constraints).toEqual([{ a: [1, 0], b: [0.5, 0.5], orient: 'any' }]);
  });
});

describe('mesh point mapping', () => {
  it('maps points forward and back through the solved mesh', async () => {
    const { solveWideAngle, meshMap, focalLengthToPixels } = await import('../src/imaging/filters/wide-angle');
    const mesh = solveWideAngle({ width: 200, height: 120, model: 'fisheye', focalPx: focalLengthToPixels(10, 1, 200, 120), constraints: [{ a: [20, 30], b: [180, 30], orient: 'horizontal' }], cols: 16 });
    for (const p of [[100, 60], [37, 91], [150, 20]] as [number, number][]) {
      const out = meshMap(mesh, p[0], p[1], true)!;
      const back = meshMap(mesh, out[0], out[1], false)!;
      expect(Math.hypot(back[0] - p[0], back[1] - p[1])).toBeLessThan(1e-6);
    }
    expect(meshMap(mesh, -500, -500, true)).toBeNull();
  });
});
