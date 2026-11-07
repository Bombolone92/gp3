import { describe, it, expect } from 'vitest';
import { renderChartSvg } from '../src/ui/chartsvg.js';
import { axisLabel } from '../src/core/charts.js';

const valueLabels = (svg) => [...svg.matchAll(/<text x="[^"]+" y="([^"]+)" text-anchor="end" font-size="11" fill="var\(--ink-3\)">([^<]*)<\/text>/g)]
  .map((m) => ({ y: Number(m[1]), label: m[2] }));
const barTops = (svg) => [...svg.matchAll(/<rect x="[^"]+" y="([^"]+)" width="[^"]+" height="[^"]+" fill="var\(--series-1, #337bfc\)" rx="1">/g)].map((m) => Number(m[1]));

describe('value labels with fixed axis bounds', () => {
  it('labels each tick with the value it sits at, however many decimals that takes', () => {
    const data = { categories: ['A', 'B', 'C'], series: [{ name: 'v', values: [2, 5, 7] }] };
    const svg = renderChartSvg(data, { type: 'column', legend: false, yMin: 1.5, yMax: 8 }, 480, 300);
    const labels = valueLabels(svg);
    expect(labels.map((l) => l.label)).toEqual(['1.5', '3.5', '5.5', '7.5']);
    // The bar worth 2 tops out a quarter of the way from the 1.5 line to the 3.5 line.
    const [barA] = barTops(svg);
    const y15 = labels[0].y - 4;
    const y35 = labels[1].y - 4;
    expect((barA - y15) / (y35 - y15)).toBeCloseTo(0.25, 2);
    const gaps = labels.slice(1).map((l, i) => labels[i].y - l.y);
    for (const gap of gaps) expect(gap).toBeCloseTo(gaps[0], 1);
  });

  it('draws no tick past a fixed maximum that is off the step', () => {
    const data = { categories: ['A', 'B'], series: [{ name: 'v', values: [3, 6] }] };
    const svg = renderChartSvg(data, { type: 'column', legend: false, yMin: 0, yMax: 9 }, 480, 300);
    expect(valueLabels(svg).map((l) => l.label)).toEqual(['0', '2', '4', '6', '8']);
  });

  it('labels a horizontal bar chart with fixed bounds exactly too', () => {
    const data = { categories: ['A', 'B'], series: [{ name: 'v', values: [30, 90] }] };
    const svg = renderChartSvg(data, { type: 'bar', legend: false, yMin: 12.5, yMax: 100 }, 480, 300);
    const labels = [...svg.matchAll(/text-anchor="middle" font-size="11" fill="var\(--ink-3\)">([^<]*)<\/text>/g)].map((m) => m[1]);
    expect(labels).toEqual(['12.5', '32.5', '52.5', '72.5', '92.5']);
  });

  it('formats percent and currency ticks off the grid exactly, and free axes as before', () => {
    expect(axisLabel(0.125, { fmt: 'percent' }, 0.1)).toBe('12.5%');
    expect(axisLabel(0.2, { fmt: 'percent' }, 0.1)).toBe('20%');
    expect(axisLabel(1.25, { fmt: 'currency', cur: 'USD' }, 2)).toBe('$1.25');
    expect(axisLabel(0.1 + 0.2, null, 0.1)).toBe('0.3'); // rounding noise is not a decimal
    expect(axisLabel(1500, null, 500)).toBe('1,500');
    const data = { categories: ['A', 'B', 'C'], series: [{ name: 'v', values: [2, 5, 7] }] };
    const svg = renderChartSvg(data, { type: 'column', legend: false }, 480, 300);
    expect(valueLabels(svg).map((l) => l.label)).toEqual(['0', '2', '4', '6', '8']);
  });
});
