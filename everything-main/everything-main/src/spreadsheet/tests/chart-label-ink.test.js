import { expect, it } from 'vitest';
import { renderChartSvg, inkOn, SERIES_COLORS } from '../src/ui/chartsvg.js';
import { defaultChart } from '../src/core/charts.js';

it('picks dark or white label ink from the fill', () => {
  expect(inkOn('#eda100')).toBe('#0b0b0b');
  expect(inkOn('#e87ba4')).toBe('#0b0b0b');
  expect(inkOn('#918f88')).toBe('#0b0b0b');
  expect(inkOn('#337bfc')).toBe('#0b0b0b');
  expect(inkOn('#4a3aa7')).toBe('#ffffff');
  expect(inkOn('#0e7490')).toBe('#ffffff');
  expect(inkOn('#8a5a00')).toBe('#ffffff');
  expect(inkOn('nonsense')).toBe('#ffffff');
  // Every palette color gets ink with at least 4.5:1 contrast.
  const lum = (hex) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  for (const color of SERIES_COLORS) {
    const ink = inkOn(color);
    const [hi, lo] = ink === '#ffffff' ? [1, lum(color)] : [lum(color), lum('#0b0b0b')];
    expect((hi + 0.05) / (lo + 0.05)).toBeGreaterThanOrEqual(4.5);
  }
});

it('labels pie slices and stacked bars in ink that reads on their color', () => {
  const data = { categories: ['a', 'b'], series: [{ name: 'S', values: [3, 7] }] };
  const base = defaultChart({ r1: 0, c1: 0, r2: 2, c2: 1 }, { r: 0, c: 3 });
  const pie = renderChartSvg(data, { ...base, type: 'pie', colors: ['#eda100', '#4a3aa7'] }, 480, 300);
  expect(pie).toContain('fill="#0b0b0b">30%');
  expect(pie).toContain('fill="#ffffff">70%');
  const stacked = renderChartSvg({ categories: ['a'], series: [{ name: 'S', values: [100] }] }, { ...base, type: 'column', stacked: true, labels: true, colors: ['#eda100'] }, 480, 300);
  expect(stacked).toContain('fill="#0b0b0b">100');
  void SERIES_COLORS;
});
