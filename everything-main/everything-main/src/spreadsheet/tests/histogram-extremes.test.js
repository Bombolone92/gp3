import { expect, it } from 'vitest';
import { histogramBins } from '../src/core/charts.js';
import { renderChartSvg } from '../src/ui/chartsvg.js';

it.each([
  [-1e308, 0, 1e308],
  [0, Number.MIN_VALUE],
  [-Number.MIN_VALUE, 0, Number.MIN_VALUE],
  [1.6e308, 1.7e308, Number.MAX_VALUE],
])('counts and renders finite histogram values at numeric extremes: %j', (...values) => {
  const result = histogramBins(values);
  expect(result.counts.reduce((sum, count) => sum + count, 0)).toBe(values.length);
  expect(result.counts.every(Number.isFinite)).toBe(true);
  expect(result.counts.length).toBeGreaterThan(0);
  expect(result.counts.length).toBeLessThanOrEqual(31);
  expect(result.categories).toHaveLength(result.counts.length);
  expect(result.categories.join(' ')).not.toMatch(/NaN|Infinity/);
  const svg = renderChartSvg({ categories: [], series: [{ name: 'Values', values }] }, { type: 'histogram' }, 480, 300);
  expect(svg).toContain('</svg>');
  expect(svg).not.toMatch(/NaN|Infinity/);
});

it('keeps ordinary histogram boundaries and endpoint counts', () => {
  expect(histogramBins([0, 2, 4, 6, 8, 10], 5)).toEqual({
    categories: ['0–2', '2–4', '4–6', '6–8', '8–10'], counts: [1, 1, 1, 1, 2],
  });
});
