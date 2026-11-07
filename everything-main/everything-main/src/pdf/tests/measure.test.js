import { expect, it } from 'vitest';
import { measureLabel, polygonArea, polylineLength, realLength } from '../src/core/measure.js';

it('converts page points to real lengths through the scale', () => {
  expect(realLength(72, { unit: 'in' })).toBeCloseTo(1);
  expect(realLength(72, { unit: 'mm' })).toBeCloseTo(25.4);
  expect(realLength(72, { unit: 'ft', ratio: 48 })).toBeCloseTo(4);
  expect(realLength(72, { unit: 'in', userUnit: 2 })).toBeCloseTo(2);
});

it('measures distances, perimeters, and areas', () => {
  const square = [
    { x: 0, y: 0 },
    { x: 72, y: 0 },
    { x: 72, y: 72 },
    { x: 0, y: 72 },
  ];
  expect(polylineLength(square)).toBe(216);
  expect(polylineLength(square, true)).toBe(288);
  expect(polygonArea(square)).toBe(5184);
  expect(measureLabel('area', square, { unit: 'in', ratio: 1 })).toBe('1.00 sq in');
  expect(measureLabel('distance', square.slice(0, 2), { unit: 'cm', ratio: 1 })).toBe('2.54 cm');
  expect(measureLabel('perimeter-closed', square, { unit: 'in', ratio: 1 })).toBe('4.00 in');
});
