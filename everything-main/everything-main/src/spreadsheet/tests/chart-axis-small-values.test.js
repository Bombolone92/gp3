import { describe, expect, it } from 'vitest';
import { axisLabel, histogramBins, niceScale } from '../src/core/charts.js';
import { renderChartSvg } from '../src/ui/chartsvg.js';

const ticksOf = (scale) => {
  const out = [];
  for (let v = scale.min; v <= scale.max + scale.step / 2; v += scale.step) out.push(axisLabel(v, null, scale.step));
  return out;
};

describe('axis labels below a millionth', () => {
  it('name each tick in the exponent form instead of a row of 0.000000', () => {
    expect(ticksOf(niceScale(0, 1e-9, 5))).toEqual(['0', '2E-10', '4E-10', '6E-10', '8E-10', '1E-09']);
    expect(ticksOf(niceScale(1e-9, 3e-9, 4))).toEqual(['1E-09', '1.5E-09', '2E-09', '2.5E-09', '3E-09']);
    expect(axisLabel(1.5e-9)).toBe('1.5E-09');
    expect(axisLabel(-2e-10, null, 2e-10)).toBe('-2E-10');
    expect(axisLabel(2e-10, { fmt: 'percent' }, 2e-10)).toBe('2E-08%');
    expect(axisLabel(0, { fmt: 'currency', cur: 'USD' }, 2e-10)).toBe('$0');
  });

  it('leave a millionth and above, and the large values, as they were', () => {
    expect(axisLabel(0.000001, null, 0.000001)).toBe('0.000001');
    expect(axisLabel(0.00001, null, 0.000005)).toBe('0.000010');
    expect(axisLabel(1e15, null, 1e15)).toBe('1E+15');
    expect(axisLabel(2.5e15, null, 5e14)).toBe('2.5E+15');
    expect(axisLabel(0.5)).toBe('0.50');
  });

  it('tell histogram bins of tiny values apart, on the chart as well', () => {
    const { categories } = histogramBins([1e-9, 2e-9, 3e-9, 4e-9]);
    expect(new Set(categories).size).toBe(categories.length);
    for (const c of categories) expect(c).toMatch(/^-?[\d.]+E-\d\d–[\d.]+E-\d\d$/);
    const svg = renderChartSvg({ categories: ['a', 'b', 'c'], series: [{ name: 'v', values: [1e-9, 2e-9, 3e-9] }] }, { type: 'column', legend: false }, 480, 300);
    const labels = [...svg.matchAll(/text-anchor="end" font-size="11" fill="var\(--ink-3\)">([^<]*)<\/text>/g)].map((m) => m[1]);
    expect(labels.length).toBeGreaterThan(2);
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels).not.toContain('0.000000');
  });
});
