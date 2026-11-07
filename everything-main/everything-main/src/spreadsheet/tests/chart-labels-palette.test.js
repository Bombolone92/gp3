import { describe, expect, it } from 'vitest';
import { axisLabel, histogramBins, niceScale } from '../src/core/charts.js';
import { renderChartSvg, seriesColor, SERIES_COLORS } from '../src/ui/chartsvg.js';

describe('axis labels', () => {
  it('take their decimals from the tick step so neighbouring ticks never read the same', () => {
    const scale = niceScale(0.001, 0.009);
    const ticks = [];
    for (let v = scale.min; v <= scale.max + scale.step / 2; v += scale.step) ticks.push(axisLabel(v, null, scale.step));
    expect(new Set(ticks).size).toBe(ticks.length);
    expect(axisLabel(0.004, null, 0.002)).toBe('0.004');
    expect(axisLabel(1000.5, null, 0.5)).toBe('1,000.5');
    expect(axisLabel(20, null, 20)).toBe('20');
  });

  it('roll thousands over into millions on the rounded figure', () => {
    expect(axisLabel(999999)).toBe('1M');
    expect(axisLabel(999950)).toBe('1M');
    expect(axisLabel(12345)).toBe('12.3K');
    expect(axisLabel(1500000)).toBe('1.5M');
    expect(axisLabel(5000)).toBe('5,000'); // below ten thousand the figure reads in full
  });

  it('read billions and trillions as B and T, and larger figures in exponent form', () => {
    expect(axisLabel(1e9)).toBe('1B');
    expect(axisLabel(2.5e9)).toBe('2.5B');
    expect(axisLabel(999999999)).toBe('1B'); // rolls over on the rounded figure, like the units below
    expect(axisLabel(-7.2e10)).toBe('-72B');
    expect(axisLabel(1e12)).toBe('1T');
    expect(axisLabel(340e12)).toBe('340T');
    expect(axisLabel(1e15)).toBe('1E+15');
    expect(axisLabel(-2.5e17)).toBe('-2.5E+17');
    expect(axisLabel(1e9, { fmt: 'currency', cur: 'USD' })).toBe('$1B');
    expect(axisLabel(3e12, { fmt: 'currency', cur: 'EUR' })).toBe('€3T');
  });

  it('give histogram bins distinct edges', () => {
    const { categories } = histogramBins([1000.1, 1000.2, 1000.3, 1000.5, 1000.7, 1000.9], 4);
    expect(new Set(categories).size).toBe(categories.length);
    for (const c of categories) { const [a, b] = c.split('–'); expect(a).not.toBe(b); }
  });
});

describe('the series palette', () => {
  it('does not repeat a colour next to itself when a pie has more slices than colours', () => {
    const n = SERIES_COLORS.length;
    expect(seriesColor(null, n)).not.toBe(seriesColor(null, 0));
    expect(seriesColor(null, n)).toMatch(/^#[0-9a-f]{6}$/);
    expect(seriesColor(null, 2 * n)).not.toBe(seriesColor(null, n));
    expect(seriesColor({ colors: [null, '#123456'] }, 1)).toBe('#123456');
    const values = Array.from({ length: n + 1 }, (_, i) => i + 1);
    const svg = renderChartSvg({ categories: values.map(String), series: [{ name: 'v', values }] }, { type: 'pie', legend: false }, 480, 300);
    const fills = [...svg.matchAll(/<path [^>]*fill="((?:var\(--series-\d+, )?#[0-9a-f]{6}\)?)"/g)].map((m) => m[1]);
    expect(fills.length).toBeGreaterThanOrEqual(n + 1);
    expect(fills[0]).not.toBe(fills[n]);
  });
});
