import { describe, expect, it } from 'vitest';
import { renderChartSvg, smoothPath } from '../src/ui/chartsvg.js';

const pathYs = (svg) => [...svg.matchAll(/<path d="([^"]+)"/g)].flatMap((m) => m[1].match(/-?[\d.]+/g).map(Number).filter((_, i) => i % 2 === 1));
const gridYs = (svg) => [...svg.matchAll(/<line x1="[^"]+" y1="([\d.]+)" x2="[^"]+" y2="\1" stroke="var\(--grid\)"/g)].map((m) => Number(m[1]));

describe('smooth lines and areas', () => {
  it('never swing past their own points, so a rise from zero stays above the baseline instead of dipping into the labels', () => {
    const data = { categories: ['a', 'b', 'c', 'd', 'e'], series: [{ name: 'v', values: [0, 10, 10, 0, 0] }] };
    for (const type of ['area', 'line']) {
      const svg = renderChartSvg(data, { type, smooth: true, legend: false }, 480, 300);
      const grid = gridYs(svg);
      const bottom = Math.max(...grid); // the zero line, at the plot's foot
      const top = Math.min(...grid);
      const ys = pathYs(svg);
      expect(ys.length).toBeGreaterThan(4);
      expect(Math.max(...ys)).toBeLessThanOrEqual(bottom + 0.01);
      expect(Math.min(...ys)).toBeGreaterThanOrEqual(top - 0.01);
      expect(svg).toMatch(/<path d="M [\d.]+ [\d.]+ C /); // still a curve
    }
  });

  it('draw a run of equal values flat and keep every point on the curve', () => {
    const flat = smoothPath([[0, 50], [10, 50], [20, 50], [30, 50]]);
    for (const y of flat.match(/-?[\d.]+/g).filter((_, i) => i % 2 === 1)) expect(Number(y)).toBe(50);
    const pts = [[0, 100], [10, 20], [20, 40], [30, 0]];
    const d = smoothPath(pts);
    for (const [x, y] of pts) expect(d).toContain(`${x} ${y}`);
    // Between two points the curve stays between their values.
    const ys = d.match(/-?[\d.]+/g).map(Number).filter((_, i) => i % 2 === 1);
    expect(Math.max(...ys)).toBeLessThanOrEqual(100);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
  });
});
