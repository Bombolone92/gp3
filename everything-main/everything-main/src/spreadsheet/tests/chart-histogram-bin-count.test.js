import { describe, expect, it } from 'vitest';
import { histogramBins } from '../src/core/charts.js';
import { renderChartSvg } from '../src/ui/chartsvg.js';

// The histogram's "Number of bins" only seeded the round-step scale, and the bin count was whatever the
// rounded step happened to yield: 10 gave 7, 3 gave 2, 4 gave 3. The histogram now gives exactly the
// number asked for, in equal-width bins over the data's range.
const bars = (svg) => (svg.match(/<rect x="[^"]+" y="[^"]+" width="[^"]+" height="[^"]+" fill="(?:var\(--series-\d+, )?#[0-9a-f]{6}\)?" rx="1"/g) || []).length;

describe('a chosen histogram bin count', () => {
  it('gives exactly that many equal-width bins over the data', () => {
    const ten = histogramBins(Array.from({ length: 13 }, (_, i) => i + 1), 10);
    expect(ten.counts).toHaveLength(10);
    expect(ten.counts.reduce((a, b) => a + b, 0)).toBe(13);
    expect(ten.categories[0]).toBe('1–2.2');
    expect(ten.categories[4]).toBe('5.8–7');
    expect(ten.categories[9]).toBe('11.8–13');
    expect(ten.counts).toEqual([2, 1, 1, 1, 1, 2, 1, 1, 1, 2]);
    expect(histogramBins([0.1, 0.2, 0.3], 3)).toEqual({ categories: ['0.1–0.167', '0.167–0.233', '0.233–0.3'], counts: [1, 1, 1] });
    expect(histogramBins([-5, -1, 0, 3, 8], 4)).toEqual({ categories: ['-5–-1.75', '-1.75–1.5', '1.5–4.75', '4.75–8'], counts: [1, 2, 1, 1] });
    expect(histogramBins([1, 2, 2, 3, 8, 9, 10], 3)).toEqual({ categories: ['1–4', '4–7', '7–10'], counts: [4, 0, 3] });
  });

  it('keeps a value on the top edge in the last bin and integer edges unadorned', () => {
    expect(histogramBins([0, 2, 4, 6, 8, 10], 5)).toEqual({ categories: ['0–2', '2–4', '4–6', '6–8', '8–10'], counts: [1, 1, 1, 1, 2] });
    expect(histogramBins([100, 200, 300, 400], 2)).toEqual({ categories: ['100–250', '250–400'], counts: [2, 2] });
  });

  it('still picks round edges and its own count when none is chosen', () => {
    expect(histogramBins(Array.from({ length: 13 }, (_, i) => i + 1))).toEqual({ categories: ['0–5', '5–10', '10–15'], counts: [4, 5, 4] });
    expect(histogramBins([5, 5, 5], 4)).toEqual({ categories: ['5'], counts: [3] });
  });

  it('draws that many bars, and stays finite at the limits of a double', () => {
    const values = Array.from({ length: 100 }, (_, i) => (i * 37) % 129 + i / 10);
    const svg = renderChartSvg({ categories: [], series: [{ name: 'v', values }] }, { type: 'histogram', bins: 10, legend: false }, 480, 300);
    expect(bars(svg)).toBe(10);
    const wide = histogramBins([-1e308, 0, 1e308], 3);
    expect(wide.counts).toEqual([1, 1, 1]);
    expect(wide.categories.join(' ')).not.toMatch(/NaN|Infinity/);
    const tiny = histogramBins([0, Number.MIN_VALUE, 2 * Number.MIN_VALUE], 4);
    expect(tiny.counts.reduce((a, b) => a + b, 0)).toBe(3);
    expect(tiny.categories.join(' ')).not.toMatch(/NaN|Infinity/);
  });
});
