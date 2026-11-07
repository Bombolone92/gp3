import { describe, expect, it } from 'vitest';
import { renderChartSvg } from '../src/ui/chartsvg.js';

// A bubble chart's value labels name the sizes, but a point whose size cell was blank was labelled with
// its value instead, so neighbouring labels meant different things (3 and 20 for sizes 3 and blank). A
// point without a size now has no label; its tooltip still says so.
const labels = (svg) => [...svg.matchAll(/<text [^>]*font-size="10"[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
const titles = (svg) => [...svg.matchAll(/<title>([^<]*)<\/title>/g)].map((m) => m[1]);

describe('bubble labels', () => {
  it('leave a point whose size is blank unlabelled rather than labelling it with its value', () => {
    const data = { categories: ['1', '2', '3'], series: [{ name: 'v', values: [10, 20, 30] }], x: [1, 2, 3], sizes: [3, null, 5] };
    const svg = renderChartSvg(data, { type: 'bubble', labels: true, legend: false }, 480, 300);
    expect(labels(svg)).toEqual(['3', '5']);
    expect(titles(svg)).toEqual(['v: (1, 10), size 3', 'v: (2, 20), size blank', 'v: (3, 30), size 5']);
    expect((svg.match(/<circle /g) || []).length).toBe(3);
  });

  it('still label scatter points with their values', () => {
    const data = { categories: ['1', '2'], series: [{ name: 'v', values: [10, 20] }], x: [1, 2] };
    expect(labels(renderChartSvg(data, { type: 'scatter', labels: true, legend: false }, 480, 300))).toEqual(['10', '20']);
  });
});
