import { describe, it, expect } from 'vitest';
import { niceScale } from '../src/core/charts.js';
import { renderChartSvg } from '../src/ui/chartsvg.js';

const valueLabels = (svg) => [...svg.matchAll(/text-anchor="end" font-size="11" fill="var\(--ink-3\)">([^<]*)</g)].map((m) => m[1]);

describe('axis bounds and floating-point noise', () => {
  it('does not open an extra step for a sum a hair past a nice number', () => {
    // Three steps of 0.1 (not four); the product itself carries the usual binary noise.
    const tenths = niceScale(0, 0.1 + 0.2);
    expect(tenths.step).toBe(0.1);
    expect(tenths.max).toBeCloseTo(0.3, 12);
    expect(niceScale(0, 100.00000000000001)).toEqual({ min: 0, max: 100, step: 20 });
    expect(niceScale(-(0.1 + 0.2), 0).min).toBeCloseTo(-0.3, 12);
    // A value that really passes the step still gets the next one.
    expect(niceScale(0, 0.31).max).toBeCloseTo(0.4, 12);
  });

  it('ends a 100% stacked axis at 100%', () => {
    const data = { categories: ['a', 'b'], series: [{ name: 's1', values: [1, 2] }, { name: 's2', values: [1, 3] }, { name: 's3', values: [9, 5] }] };
    const labels = valueLabels(renderChartSvg(data, { type: 'column', stacked: true, stack100: true, legend: false }, 480, 300));
    expect(labels[labels.length - 1]).toBe('100%');
    expect(labels).not.toContain('150%');
    const plain = valueLabels(renderChartSvg({ categories: ['a'], series: [{ name: 's1', values: [0.1] }, { name: 's2', values: [0.2] }] }, { type: 'column', stacked: true, legend: false }, 480, 300));
    // Ordinary stacks receive genuine range headroom; a normalized 100%
    // stack above must still stop at 100%, without a floating-point extra tick.
    expect(plain[plain.length - 1]).toBe('0.4');
  });
});
