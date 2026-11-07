import { describe, expect, it } from 'vitest';
import { renderChartSvg } from '../src/ui/chartsvg.js';

// Bar series past the sixty drawn were folded into one segment holding their sum, so a stack's totals
// stayed true; a stacked area chart merely cut its series at sixty and stacked those, while its axis was
// still computed over every series: 80 series of 1 ran the axis to 80 with the top of the stack on the 60
// gridline and nothing on the plot holding the missing 20.
const many = (n, seriesCount, value = () => 1) => ({
  categories: Array.from({ length: n }, (_, i) => `c${i}`),
  series: Array.from({ length: seriesCount }, (_, s) => ({ name: `s${s}`, values: Array.from({ length: n }, (_, i) => value(i, s)) })),
});
const polygons = (svg) => [...svg.matchAll(/<polygon points="([^"]+)" fill="([^"]+)"/g)].map((m) => ({ top: Number(m[1].split(' ')[0].split(',')[1]), fill: m[2] }));
const gridlineY = (svg, label) => Number(new RegExp(`<text x="[^"]+" y="([^"]+)" text-anchor="end" font-size="11" fill="var\\(--ink-3\\)">${label}</text>`).exec(svg)[1]) - 4;
const titles = (svg) => [...svg.matchAll(/<title>([^<]*)<\/title>/g)].map((m) => m[1]);

describe('a stacked area chart past the series cap', () => {
  it('folds the rest into one summed series drawn last, so the stack reaches the axis\'s total', () => {
    const svg = renderChartSvg(many(5, 80), { type: 'area', stacked: true, legend: false }, 480, 300);
    const polys = polygons(svg);
    expect(polys).toHaveLength(61); // sixty series and the fold
    expect(polys[60].fill).toBe('var(--ink-3)');
    expect(polys[60].top).toBeCloseTo(gridlineY(svg, '80'), 1);
    expect(polys[59].top).toBeCloseTo(gridlineY(svg, '60'), 1);
    const tips = titles(svg);
    expect(tips).toContain('…and 20 more · c0: 20');
    expect(tips).toContain('s59 · c0: 1');
    expect(tips).not.toContain('s60 · c0: 1');
  });

  it('names the values with their shares on a 100% stacked area', () => {
    const svg = renderChartSvg(many(4, 100), { type: 'area', stacked: true, stack100: true, legend: false }, 480, 300);
    expect(polygons(svg)).toHaveLength(61);
    expect(polygons(svg)[60].top).toBeCloseTo(gridlineY(svg, '100%'), 1);
    expect(titles(svg)).toContain('…and 40 more · c0: 40 (40%)');
  });

  it('still only cuts the series of an unstacked line or area chart, where nothing is lost', () => {
    const line = renderChartSvg(many(10, 80, (i, s) => 1 + ((i + s) % 7)), { type: 'line', legend: false }, 480, 300);
    expect((line.match(/<polyline /g) || []).length).toBe(60);
    expect(line).not.toContain('…and 20 more');
    const area = renderChartSvg(many(10, 80), { type: 'area', legend: false }, 480, 300);
    expect(polygons(area)).toHaveLength(60);
    expect(polygons(area).some((p) => p.fill === 'var(--ink-3)')).toBe(false);
  });
});
