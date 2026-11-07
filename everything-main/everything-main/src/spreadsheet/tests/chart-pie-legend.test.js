import { describe, it, expect } from 'vitest';
import { renderChartSvg } from '../src/ui/chartsvg.js';

const legendTexts = (svg) => [...svg.matchAll(/<text x="[^"]+" y="[^"]+" font-size="12" fill="var\(--ink-2\)">([^<]*)<\/text>/g)].map((m) => m[1]);
const slices = (svg) => (svg.match(/<path d="M /g) || []).length;

describe('pie legend', () => {
  it('lists only the categories that have a slice', () => {
    const data = { categories: ['Rent', 'Refund', 'Food', 'Nothing'], series: [{ name: 'v', values: [500, -120, 300, 0] }] };
    const svg = renderChartSvg(data, { type: 'pie', legend: true }, 480, 300);
    expect(slices(svg)).toBe(3);
    expect(legendTexts(svg)).toEqual(['Rent', 'Refund', 'Food']);
    // Each entry keeps the colour of its slice.
    const swatches = [...svg.matchAll(/<rect x="[^"]+" y="[^"]+" width="10" height="10" rx="2" fill="([^"]+)"\/>/g)].map((m) => m[1]);
    const fills = [...svg.matchAll(/<path d="M [^"]+" fill="([^"]+)"/g)].map((m) => m[1]);
    expect(swatches).toEqual(fills);
  });

  it('keeps a legend for many slices, ending with how many more there are', () => {
    const categories = Array.from({ length: 15 }, (_, i) => `Slice ${i + 1}`);
    const data = { categories, series: [{ name: 'v', values: categories.map((_, i) => 15 - i) }] };
    const svg = renderChartSvg(data, { type: 'donut', legend: true }, 480, 300);
    const texts = legendTexts(svg);
    expect(texts.slice(0, 11)).toEqual(categories.slice(0, 11));
    expect(texts[11]).toBe('…and 4 more');
    expect(texts).toHaveLength(12);
    const right = renderChartSvg(data, { type: 'pie', legend: true, legendPos: 'right' }, 480, 300);
    expect(legendTexts(right)).toContain('…and 4 more');
  });

  it('counts the entries a short right-hand legend has no room for instead of dropping them', () => {
    const series = Array.from({ length: 10 }, (_, i) => ({ name: `Series ${i + 1}`, values: [i + 1] }));
    const short = renderChartSvg({ categories: ['a'], series }, { type: 'column', legend: true, legendPos: 'right' }, 480, 120);
    const texts = legendTexts(short);
    expect(texts.length).toBeGreaterThan(1);
    expect(texts.length).toBeLessThan(10);
    expect(texts[texts.length - 1]).toBe(`…and ${10 - (texts.length - 1)} more`);
    expect(texts.slice(0, -1)).toEqual(series.slice(0, texts.length - 1).map((s) => s.name));
    // With room for every row, nothing is counted off.
    const tall = renderChartSvg({ categories: ['a'], series }, { type: 'column', legend: true, legendPos: 'right' }, 480, 400);
    expect(legendTexts(tall)).toEqual(series.map((s) => s.name));
    // Past a dozen entries the count covers both what the dozen and the height left out.
    const many = Array.from({ length: 15 }, (_, i) => ({ name: `S${i + 1}`, values: [1] }));
    const both = legendTexts(renderChartSvg({ categories: ['a'], series: many }, { type: 'column', legend: true, legendPos: 'right' }, 480, 120));
    expect(both[both.length - 1]).toBe(`…and ${15 - (both.length - 1)} more`);
  });

  it('still shows every entry of a twelve-slice pie, and none when the legend is off', () => {
    const categories = Array.from({ length: 12 }, (_, i) => `S${i + 1}`);
    const data = { categories, series: [{ name: 'v', values: categories.map(() => 1) }] };
    expect(legendTexts(renderChartSvg(data, { type: 'pie', legend: true }, 480, 300))).toEqual(categories);
    expect(legendTexts(renderChartSvg(data, { type: 'pie', legend: false }, 480, 300))).toEqual([]);
  });
});
