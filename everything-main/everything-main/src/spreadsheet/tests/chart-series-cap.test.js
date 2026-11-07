import { describe, expect, it } from 'vitest';
import { renderChartSvg } from '../src/ui/chartsvg.js';

// Categories were thinned to the plot's pixels but every series was drawn: a tall range charted with
// "Series in: rows" made a series of each row, and 5,000 of them over 199 categories built an 81 MB SVG of
// a million <rect>s that the grid then assigned to innerHTML on every redraw.
const rects = (svg) => (svg.match(/<rect x="[^"]+" y="[^"]+" width="[^"]+" height="[^"]+" fill="(?:var\(--series-\d+, )?#[0-9a-f]{6}\)?" rx="1"/g) || []).length;
const titles = (svg) => [...svg.matchAll(/<title>([^<]*)<\/title>/g)].map((m) => m[1]);
const many = (n, seriesCount, value = (i, s) => 1 + ((i + s) % 7)) => ({
  categories: Array.from({ length: n }, (_, i) => `c${i}`),
  series: Array.from({ length: seriesCount }, (_, s) => ({ name: `s${s}`, values: Array.from({ length: n }, (_, i) => value(i, s)) })),
});

describe('charts with thousands of series', () => {
  it('draw at most sixty series of grouped bars and count the rest in the legend', { timeout: 60000 }, () => {
    const svg = renderChartSvg(many(199, 5000), { type: 'column' }, 480, 300);
    expect(rects(svg)).toBeLessThanOrEqual(60 * 199);
    expect(rects(svg)).toBeGreaterThan(199);
    expect(svg.length).toBeLessThan(2_500_000);
    expect(svg).toContain('…and 4989 more'); // the legend keeps its first eleven and counts the rest
    const bars = renderChartSvg(many(100, 2000), { type: 'bar', legend: false }, 480, 300);
    expect(rects(bars)).toBeLessThanOrEqual(60 * 100);
  });

  it('draw at most sixty lines, radar polygons and scatter series', () => {
    const line = renderChartSvg(many(100, 2000), { type: 'line', legend: false }, 480, 300);
    expect((line.match(/<polyline /g) || []).length).toBeLessThanOrEqual(60);
    expect(line.length).toBeLessThan(1_000_000);
    const radar = renderChartSvg(many(12, 500), { type: 'radar', legend: false }, 480, 300);
    expect((radar.match(/<polygon points="[^"]+" fill="(?:var\(--series-\d+, )?#/g) || []).length).toBeLessThanOrEqual(60);
  });

  it('fold the series past the cap of a stack into one segment, so every total stays true', () => {
    const data = many(10, 200, () => 1); // every stack totals 200
    const svg = renderChartSvg(data, { type: 'column', stacked: true, legend: false, labels: false }, 480, 300);
    expect(rects(svg)).toBe(10 * 60); // sixty series per category in the palette…
    expect((svg.match(/fill="var\(--ink-3\)" rx="1"/g) || []).length).toBe(10); // …and the fold, in the neutral ink
    const tips = titles(svg);
    expect(tips).toContain('…and 140 more · c0: 140');
    expect(tips).toContain('s59 · c0: 1');
    expect(tips).not.toContain('s60 · c0: 1');
    // The axis reaches the true total and the fold's segment is drawn in the neutral ink.
    expect(svg).toMatch(/fill="var\(--ink-3\)">200</);
    expect(svg).toContain('fill="var(--ink-3)" rx="1"');
    const pct = renderChartSvg(data, { type: 'column', stacked: true, stack100: true, legend: false }, 480, 300);
    expect(titles(pct)).toContain('…and 140 more · c0: 140 (70%)');
  });

  it('leave charts within the cap as they were', () => {
    const svg = renderChartSvg(many(12, 60), { type: 'column', legend: false }, 480, 300);
    expect(rects(svg)).toBe(12 * 60);
    expect(titles(svg)).toHaveLength(12 * 60);
    const trend = renderChartSvg(many(12, 3), { type: 'column', legend: false, trendline: true }, 480, 300);
    expect((trend.match(/stroke-dasharray="5 4"/g) || []).length).toBe(3);
  });
});
