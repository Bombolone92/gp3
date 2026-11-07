import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { projection3d, intersectExtrusion } from '../src/engine/drawing-3d-geometry.js';

const reference = JSON.parse(readFileSync('tests/fixtures/picture-3d/reference.json', 'utf8'));
it('uses the exact independently captured reference fixture', () => {
  expect(createHash('sha256').update(readFileSync('public/fixtures/picture-3d.docx')).digest('hex')).toBe(reference.sourceSha256);
});
for (const c of reference.cases.filter(c => c.geometry === 'rect' && !c.contourPt)) {
  it(`matches the native reference ${c.name} projected silhouette at both front and side surfaces`, () => {
    const camera = projection3d({ turn: c.camera === 'perspectiveRight' ? 20 : c.camera === 'perspectiveLeft' ? -20 : 0, perspective: c.camera !== 'orthographicFront' });
    for (const row of c.rows) {
      // A scan on the exact top/bottom face boundary measures the PDF's
      // antialiasing fringe rather than the solid's geometric intersection.
      if ([140, 140 + c.heightPt].includes(row.y)) continue;
      const xs = [];
      for (let x = 60; x < 140 + c.widthPt; x += .125) {
        const ray = camera.ray(x - 100 - c.widthPt / 2, row.y - 140 - c.heightPt / 2);
        if (intersectExtrusion(ray, { width: c.widthPt, height: c.heightPt, depth: c.extrusionPt })) xs.push(x);
      }
      expect(Boolean(xs.length), `y=${row.y}`).toBe(Boolean(row.interval));
      if (row.interval) {
        const actual = [xs[0], xs.at(-1) + .125];
        for (const edge of [0, 1]) expect(Math.abs(actual[edge] - row.interval[edge]), `y=${row.y} edge=${edge}`).toBeLessThanOrEqual(.75);
      }
    }
  });
}
it.each([-20, 0, 20])('inverts projection through a front-face intersection at turn %s', turn => {
  const camera = projection3d({ turn });
  for (const point of [[-30, -20, 0], [0, 0, 0], [30, 20, 0]]) {
    const hit = intersectExtrusion(camera.ray(...camera.project(point)), { width: 144, height: 108, depth: 20 });
    expect(hit.surface).toBe('front');
    hit.point.forEach((v, i) => expect(v).toBeCloseTo(point[i], 8));
  }
});
it('intersects elliptical side walls and normalizes their normals', () => {
  const shape = { width: 100, height: 50, depth: 20, geometry: 'ellipse' };
  const hit = intersectExtrusion({ origin: [100, 0, -10], direction: [-1, 0, 0] }, shape);
  expect(hit.point).toEqual([50, 0, -10]); expect(hit.normal).toEqual([1, 0, 0]); expect(hit.surface).toBe('side');
  const slow = intersectExtrusion({ origin: [100, 0, -10], direction: [-1e-8, 0, 0] }, shape);
  expect(slow.point[0]).toBeCloseTo(50, 8);
  expect(intersectExtrusion({ origin: [100, 0, 5], direction: [-1, 0, 0] }, shape)).toBeNull();
});
it('keeps a zero-depth face and rejects invalid cameras, rays and solids', () => {
  expect(intersectExtrusion(projection3d().ray(0, 0), { width: 100, height: 50 }).surface).toBe('front');
  expect(() => projection3d({ turn: NaN })).toThrow();
  expect(() => projection3d({ perspective: 'true' })).toThrow();
  expect(() => intersectExtrusion({ origin: [0, 0, 1], direction: [0, 0, 0] }, { width: 1, height: 1 })).toThrow();
  expect(() => intersectExtrusion(projection3d().ray(0, 0), { width: 0, height: 1 })).toThrow();
  expect(() => projection3d().project([0, 0, 1e9])).toThrow(/camera plane/);
});
