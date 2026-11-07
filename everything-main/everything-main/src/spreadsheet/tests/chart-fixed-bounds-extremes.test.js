import { describe, expect, it } from 'vitest';
import { renderChartSvg, linearFit } from '../src/ui/chartsvg.js';

const MAX = 1.7976931348623157e308;
const data = { categories: ['a', 'b', 'c'], series: [{ name: 'v', values: [MAX, -MAX, 1] }] };
const wellFormed = (svg) => {
  expect(svg).not.toMatch(/Infinity|NaN/);
  expect(svg).toMatch(/<\/svg>$/);
};

describe('values at the double limit under fixed axis bounds', () => {
  it('draw finite, clipped marks instead of Infinity coordinates', () => {
    for (const type of ['column', 'bar', 'line', 'area', 'combo']) {
      const svg = renderChartSvg(data, { type, yMin: 0, yMax: 1, legend: false }, 480, 300);
      wellFormed(svg);
      // The marks lie under the plot's clip: nothing is drawn thousands of pixels away.
      for (const n of svg.match(/<(?:rect|circle|polyline|polygon|path)[^>]*>/g).flatMap((tag) => (tag.match(/-?\d[\d.]*(?:e[+-]?\d+)?/g) || []).map(Number))) expect(Math.abs(n)).toBeLessThan(1e5);
    }
    const scatter = renderChartSvg({ ...data, x: [1, 2, 3] }, { type: 'scatter', yMin: 0, yMax: 1, legend: false }, 480, 300);
    wellFormed(scatter);
  });

  it('draw a trendline with finite ends, or none, rather than one at NaN', () => {
    for (const bounds of [{ yMin: 0, yMax: 1 }, {}]) {
      const svg = renderChartSvg(data, { type: 'column', legend: false, trendline: true, ...bounds }, 480, 300);
      wellFormed(svg);
      const line = renderChartSvg(data, { type: 'line', legend: false, trendline: true, ...bounds }, 480, 300);
      wellFormed(line);
    }
    expect(linearFit([[0, MAX], [1, -MAX]])).toBeNull(); // the slope overflows: no fit
    expect(linearFit([[0, 1], [1, 3], [2, 5]])).toEqual({ slope: 2, intercept: 1 });
  });
});
