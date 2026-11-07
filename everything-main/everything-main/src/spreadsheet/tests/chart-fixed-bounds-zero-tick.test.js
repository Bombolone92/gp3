import { describe, expect, it } from 'vitest';
import { renderChartSvg } from '../src/ui/chartsvg.js';

// Ticks were placed at min + i × step in floating point, so with fixed bounds of -0.3 and 0.2 the fourth
// tick came out as 5.551115123125783e-17 rather than 0, and the label code, taking any non-zero value under
// a millionth for a genuinely tiny number, wrote it as 5.55E-17 (5.55E-15% on a percent axis).
const yLabels = (svg) => [...svg.matchAll(/text-anchor="end" font-size="11" fill="var\(--ink-3\)">([^<]*)<\/text>/g)].map((m) => m[1]);
const xLabels = (svg) => [...svg.matchAll(/text-anchor="middle" font-size="11" fill="var\(--ink-3\)">([^<]*)<\/text>/g)].map((m) => m[1]);
const data = { categories: ['A', 'B', 'C'], series: [{ name: 'v', values: [-0.2, 0.1, 0.15] }] };

describe('the zero tick of a fixed-bound axis', () => {
  it('reads 0.0, in the step\'s decimals like its neighbours, not 5.55E-17, where the bounds put it a sub-step sum away from zero', () => {
    expect(yLabels(renderChartSvg(data, { type: 'column', legend: false, yMin: -0.3, yMax: 0.2 }, 480, 300))).toEqual(['-0.3', '-0.2', '-0.1', '0.0', '0.1', '0.2']);
    expect(xLabels(renderChartSvg(data, { type: 'bar', legend: false, yMin: -0.3, yMax: 0.2 }, 480, 300))).toEqual(['-0.3', '-0.2', '-0.1', '0.0', '0.1', '0.2']);
    expect(yLabels(renderChartSvg(data, { type: 'line', legend: false, yMin: -0.6, yMax: 0.4 }, 480, 300))).toEqual(['-0.6', '-0.4', '-0.2', '0.0', '0.2', '0.4']);
    // A free axis over the same data lands on the same grid and read the same way before.
    expect(yLabels(renderChartSvg({ ...data, series: [{ name: 'v', values: [-0.25, 0.1, 0.15] }] }, { type: 'column', legend: false }, 480, 300))).toEqual(['-0.3', '-0.2', '-0.1', '0.0', '0.1', '0.2']);
  });

  it('reads 0% on a percent axis', () => {
    const svg = renderChartSvg({ ...data, valueStyle: { fmt: 'percent' } }, { type: 'column', legend: false, yMin: -0.3, yMax: 0.2 }, 480, 300);
    expect(yLabels(svg)).toEqual(['-30%', '-20%', '-10%', '0%', '10%', '20%']);
  });

  it('leaves ticks that really sit off the step grid where they are', () => {
    const off = { categories: ['A', 'B', 'C'], series: [{ name: 'v', values: [2, 5, 7] }] };
    expect(yLabels(renderChartSvg(off, { type: 'column', legend: false, yMin: 1.5, yMax: 8 }, 480, 300))).toEqual(['1.5', '3.5', '5.5', '7.5']);
    expect(yLabels(renderChartSvg(off, { type: 'column', legend: false, yMin: -0.7, yMax: 0.3 }, 480, 300))).toEqual(['-0.7', '-0.5', '-0.3', '-0.1', '0.1', '0.3']);
    // Genuinely tiny values keep their exponent labels.
    const tiny = renderChartSvg({ categories: ['a', 'b', 'c'], series: [{ name: 'v', values: [1e-9, 2e-9, 3e-9] }] }, { type: 'column', legend: false }, 480, 300);
    expect(yLabels(tiny)).toContain('1E-09');
  });
});
