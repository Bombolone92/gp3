import { expect, it } from 'vitest';
import { chartDateAxis } from '../src/core/chart-date-axis.js';
import { CALENDAR_END, ymdToSerial as d } from '../src/core/format.js';

it('retains empty calendar days inside explicit bounds and separates centers from boundaries', () => {
  const axis = chartDateAxis([45000, 45002, 45005, 45009], { min: 44996, max: 45014 });
  expect(axis.span).toBe(19);
  expect(axis.fraction(45000)).toBe(4.5 / 19);
  expect(axis.fraction(44996, -.5)).toBe(0);
  expect(axis.ticks(3, 'days')).toEqual([44996, 44999, 45002, 45005, 45008, 45011, 45014]);
  expect(axis.ticks(1, 'days', true).at(-1)).toBe(45015);
  expect(axis.fraction(45015, -.5)).toBe(1);
  expect(axis.crossing(45002)).toBe(6 / 19);
  expect(axis.crossing('max')).toBe(1);
  expect(axis.crossing(45014)).toBe(18 / 19);
});
it.each(['days', 'months', 'years'])('uses whole %s categories with an independent calendar tick interval', baseUnit => {
  const min = d(2024, 1, 10), max = d(2026, 7, 20);
  const axis = chartDateAxis([], { min, max, baseUnit });
  const positions = [d(2024, 1, 15), d(2024, 1, 31), d(2024, 2, 1), d(2025, 1, 1)].map(v => axis.fraction(v));
  const at = v => axis.fraction(v);
  expect(at(d(2024, 1, 15) + .9)).toBe(at(d(2024, 1, 15)));
  if (baseUnit !== 'days') {
    expect(at(d(2024, 1, 15))).toBe(at(d(2024, 1, 31)));
    expect(axis.min).toBe(d(2024, 1, 1));
    expect(axis.max).toBe(baseUnit === 'years' ? d(2026, 1, 1) : d(2026, 7, 1));
  }
  if (baseUnit === 'years') expect(at(d(2024, 2, 1))).toBe(at(d(2024, 1, 1)));
  const expected = baseUnit === 'days' ? [d(2024, 1, 10), d(2025, 1, 10), d(2026, 1, 10)]
    : [d(2024, 1, 1), d(2025, 1, 1), d(2026, 1, 1)];
  expect(axis.ticks(1, 'years')).toEqual(expected);
  expect(positions.every(Number.isFinite)).toBe(true);
});
it('spaces calendar months equally despite unequal month lengths and floors bounds to base units', () => {
  const axis = chartDateAxis([d(2024, 2, 29)], { min: d(2024, 1, 10), max: d(2024, 7, 20), baseUnit: 'months' });
  expect(axis.span).toBe(7);
  expect(axis.fraction(d(2024, 2, 29))).toBe(1.5 / 7);
  expect(axis.ticks(1, 'months')).toEqual(Array.from({ length: 7 }, (_, i) => d(2024, i + 1, 1)));
  expect(axis.ticks(1, 'months', true).at(-1)).toBe(d(2024, 8, 1));
  expect(axis.crossing(d(2024, 5, 20))).toBe(4 / 7);
});
it.each([
  ['months', d(2024, 1, 31), d(2024, 4, 30), [d(2024, 1, 31), d(2024, 2, 29), d(2024, 3, 31), d(2024, 4, 30)]],
  ['years', d(2024, 2, 29), d(2028, 2, 29), [d(2024, 2, 29), d(2025, 2, 28), d(2026, 2, 28), d(2027, 2, 28), d(2028, 2, 29)]],
])('keeps the tick anniversary for %s intervals over a daily base', (unit, min, max, expected) => {
  expect(chartDateAxis([], { min, max }).ticks(1, unit)).toEqual(expected);
});
it('centers one between-date category, but gives one on-date category a base interval', () => {
  const between = chartDateAxis([45000]), on = chartDateAxis([45000], { between: false });
  expect(between.fraction(45000)).toBe(.5);
  expect(between.ticks()).toEqual([45000]);
  expect(between.ticks(1, 'days', true)).toEqual([45000, 45001]);
  expect(on.fraction(45000)).toBe(0);
  expect(on.ticks()).toEqual([45000, 45001]);
});
it('keeps one-sided bounds, clamps crossings and recovers deterministically from reversed bounds', () => {
  const lo = chartDateAxis([45000, 45003], { min: 44996 });
  const hi = chartDateAxis([45000, 45003], { max: 45010 });
  expect([lo.min, lo.max]).toEqual([44996, 45003]);
  expect([hi.min, hi.max]).toEqual([45000, 45010]);
  const bad = chartDateAxis([45000, 45003], { min: 45010, max: 44999 });
  expect([bad.min, bad.max]).toEqual([45010, 45011]);
  expect(bad.crossing(-1e100)).toBe(0);
  expect(bad.crossing(1e100)).toBe(1);
  expect(bad.crossing(NaN)).toBe(0);
});
it('rejects invalid calendar values and bounds without NaN geometry or unbounded tick loops', () => {
  const axis = chartDateAxis([NaN, Infinity, 1e100, -1e100, null, 45000], { min: Infinity, max: 1e100, baseUnit: 'invalid' });
  expect(axis.min).toBe(45000); expect(axis.max).toBe(45000);
  expect(axis.ticks(0)).toEqual([45000]);
  expect(Number.isNaN(axis.fraction(NaN))).toBe(true);
  expect(chartDateAxis([0, CALENDAR_END - 1]).ticks(.000001)).toHaveLength(1000);
});
it('handles the last calendar date and a terminal year boundary without invalid labels', () => {
  const axis = chartDateAxis([CALENDAR_END - 1], { between: false });
  expect(axis.ticks()).toEqual([CALENDAR_END - 2, CALENDAR_END - 1]);
  const years = chartDateAxis([CALENDAR_END - 1], { baseUnit: 'years' });
  expect(years.ticks(1, 'years', true)).toEqual([d(9999, 1, 1), CALENDAR_END]);
  expect(years.fraction(CALENDAR_END, -.5)).toBe(1);
  for (const baseUnit of ['days', 'months', 'years']) {
    const last = chartDateAxis([45000], { min: CALENDAR_END - 1, baseUnit });
    expect(last.ticks().every(v => v < CALENDAR_END)).toBe(true);
    expect(last.span).toBe(1);
    const first = chartDateAxis([45000], { max: 0, baseUnit });
    expect(first.span).toBe(1);
  }
});
it('scans large date vectors without spreading them into function arguments', () => {
  const values = Array.from({ length: 200000 }, (_, i) => 45000 + i % 400);
  const axis = chartDateAxis(values);
  expect([axis.min, axis.max, axis.span]).toEqual([45000, 45399, 400]);
});
