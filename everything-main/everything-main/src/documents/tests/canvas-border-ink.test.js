import { it, expect } from 'vitest';
import { borderInkPolygon, containsBorderDot } from '../src/engine/border-ink.js';
const area = points => Math.abs(points.reduce((n, a, i) => { const b = points[(i + 1) % points.length]; return n + a[0] * b[1] - a[1] * b[0]; }, 0)) / 2;
it('intersects unequal paragraph corners with individual bands without losing their ink area', () => {
 const corner = [[0, 0], [10, 0], [8, 2], [2, 2]];
 const first = borderInkPolygon(corner, { x: 0, y: 0, width: 10, height: 1 });
 const second = borderInkPolygon(corner, { x: 0, y: 1, width: 10, height: 1 });
 expect(area(first)).toBe(9); expect(area(second)).toBe(7); expect(area(first) + area(second)).toBe(area(corner));
 expect(area(borderInkPolygon([...corner].reverse(), { x: 0, y: 1, width: 10, height: 1 }))).toBe(7);
});
it('intersects cell bounds and partial dashes in geometry and rejects empty intersections', () => {
 const box = { x: 3.25, y: 5.125, width: 7.5, height: 2 };
 const ink = borderInkPolygon(undefined, box, { top: 5.5, bottom: 6.75 });
 expect(area(ink)).toBeCloseTo(7.5 * 1.25); expect(ink.every(([x, y]) => x >= 3.25 && x <= 10.75 && y >= 5.5 && y <= 6.75)).toBe(true);
 expect(borderInkPolygon(undefined, box, { top: 8, bottom: 9 })).toEqual([]);
 expect(borderInkPolygon(undefined, { ...box, width: 0 })).toEqual([]);
});
it('distinguishes complete tangent dots from dots crossing an edge or slanted corner', () => {
 const rectangle = [[0, 0], [10, 0], [10, 2], [0, 2]], corner = [[0, 0], [10, 0], [8, 2], [2, 2]];
 for (const points of [rectangle, [...rectangle].reverse()]) {
  expect(containsBorderDot(points, 5, 1, 1)).toBe(true);
  expect(containsBorderDot(points, .5, 1, 1)).toBe(false);
  expect(containsBorderDot(points, 5, 1.01, 1)).toBe(false);
 }
 expect(containsBorderDot(corner, 2, 1, 1)).toBe(false);
 expect(containsBorderDot(corner, 5, 1, 1)).toBe(true);
 expect(containsBorderDot([], 0, 0, 1)).toBe(false);
});
it('preserves intersection areas and dot containment under translation and scaling', () => {
 for (const scale of [.25, .75, 1.5, 4]) {
  const dx = 23.375, dy = -18.625, points = [[0, 0], [10, 0], [8, 2], [2, 2]].map(([x, y]) => [dx + x * scale, dy + y * scale]);
  const ink = borderInkPolygon(points, { x: dx, y: dy + scale, width: 10 * scale, height: scale });
  expect(area(ink)).toBeCloseTo(7 * scale ** 2, 8);
  expect(containsBorderDot(points, dx + 5 * scale, dy + scale, scale)).toBe(true);
 }
});
