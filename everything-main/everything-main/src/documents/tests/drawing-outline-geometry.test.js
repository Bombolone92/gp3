import { it, expect } from 'vitest';
import { outlineDistance, outlineBoundary, intersectOffsetExtrusion } from '../src/engine/drawing-outline-geometry.js';
import { projection3d } from '../src/engine/drawing-3d-geometry.js';

it('computes signed ellipse distance and the closest-point normal, including both symmetry axes', () => {
  for (const [w, h] of [[144, 108], [108, 144], [100, 100]]) {
    for (const angle of [0, .2, .7, 1.1, Math.PI / 2, 2, 3.8, 5.7]) {
      const x = w / 2 * Math.cos(angle), y = h / 2 * Math.sin(angle);
      const nx = x / (w * w), ny = y / (h * h), length = Math.hypot(nx, ny);
      for (const offset of [-4, 0, 4]) {
        const result = outlineDistance(x + nx / length * offset, y + ny / length * offset, w, h, 'ellipse');
        expect(result.distance).toBeCloseTo(offset, 6);
        expect(result.normal[0]).toBeCloseTo(nx / length, 6); expect(result.normal[1]).toBeCloseTo(ny / length, 6);
      }
    }
    expect(outlineDistance(0, 0, w, h, 'ellipse').distance).toBe(-Math.min(w, h) / 2);
  }
});
it('constructs a constant-distance ellipse outline instead of inflating its axes', () => {
  for (const [x, y] of outlineBoundary(144, 108, 'ellipse', 8, 64)) expect(outlineDistance(x, y, 144, 108, 'ellipse').distance).toBeCloseTo(8, 6);
});
it('keeps rounded rectangle corners outside the solid and joins the side-wall normals', () => {
  const shape = { width: 100, height: 80, geometry: 'rect', depth: 20 };
  expect(intersectOffsetExtrusion({ origin: [-59, -49, 100], direction: [0, 0, -1] }, shape, 10)).toBeNull();
  const cap = intersectOffsetExtrusion({ origin: [-55, -45, 100], direction: [0, 0, -1] }, shape, 10);
  expect(cap.surface).toBe('front');
  const side = intersectOffsetExtrusion({ origin: [-100, -45, -10], direction: [1, 0, 0] }, shape, 10);
  expect(side.point[0]).toBeCloseTo(-50 - Math.sqrt(75), 6); expect(side.normal[1]).toBeCloseTo(-.5, 6);
});
it('intersects the true offset ellipse under both supported perspective turns', () => {
  for (const turn of [-20, 20]) {
    const camera = projection3d({ turn }), shape = { width: 144, height: 108, depth: 20, geometry: 'ellipse' };
    let sides = 0;
    for (const x of [-80, -70, -40, 0, 40, 70, 80]) for (const y of [-45, 0, 45]) {
      const hit = intersectOffsetExtrusion(camera.ray(x, y), shape, 8);
      if (hit?.surface === 'side') {
        sides++;
        expect(outlineDistance(hit.point[0], hit.point[1], 144, 108, 'ellipse').distance).toBeCloseTo(8, 5);
        expect(Math.hypot(...hit.normal)).toBeCloseTo(1, 6);
      }
    }
    expect(sides).toBeGreaterThan(0);
  }
});
