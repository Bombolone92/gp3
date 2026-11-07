import { expect, it } from 'vitest';
import { renderChartSvg } from '../src/ui/chartsvg.js';
import { workbookFromFile } from '../src/core/io.js';
import { pieXlsx } from './helpers/xlsx-pie-fixture.js';

const data = values => ({ categories: values.map((_, i) => `Category ${i}`), series: [{ name: 'Values', values }] });
const paths = svg => [...svg.matchAll(/<path d="([^"]+)"[^>]*><title>/g)].map(m => m[1]);

it.each(['pie', 'donut'])('uses magnitudes for %s geometry and signed values and percentages for text', type => {
  for (const values of [[-3, 1], [-3, -1], [-2.5, 0, 7.5, null, -5], [-9]]) {
    const before = [...values], chart = { type, legend: false };
    const svg = renderChartSvg(data(values), chart, 520, 330);
    expect(paths(svg)).toEqual(paths(renderChartSvg(data(values.map(v => v == null ? null : Math.abs(v))), chart, 520, 330)));
    expect(paths(svg)).toHaveLength(values.filter(v => v !== null && v !== 0).length);
    expect(svg).not.toMatch(/NaN|Infinity|No .*numbers/);
    expect(values).toEqual(before);
  }
  const svg = renderChartSvg(data([-3, 1]), { type, legend: false }, 520, 330);
  expect(svg).toContain('Category 0: -3 (-75%)');
  expect(svg).toContain('Category 1: 1 (25%)');
});

it.each(['pieChart', 'doughnutChart'])('keeps signed values in %s native value labels, percentages and rich fields', async type => {
  const wb = await workbookFromFile(pieXlsx({ type }), 'labels.xlsx');
  const chart = wb.sheets[0].charts[0], label = chart.appearance.pie.labels;
  Object.assign(label, { category: false, value: true, percent: true, separator: ' / ', numberFormat: null, points: [] });
  const svg = () => renderChartSvg(data([-3, 1]), chart, 640, 420);
  expect(svg()).toContain('-3 / -75%');
  label.content = [{ kind: 'value' }, { kind: 'text', text: ' => ' }, { kind: 'percent' }];
  label.numberFormat = '0.00';
  expect(svg()).toContain('-3.00 =&gt; -0.75');
});

it.each(['pie', 'donut'])('keeps %s ratios finite when finite magnitudes overflow their sum', type => {
  const svg = renderChartSvg(data([-Number.MAX_VALUE, Number.MAX_VALUE]), { type, legend: false }, 500, 300);
  expect(paths(svg)).toEqual(paths(renderChartSvg(data([-1, 1]), { type, legend: false }, 500, 300)));
  expect(svg).toContain('(-50%)'); expect(svg).toContain('(50%)');
  expect(svg).not.toMatch(/NaN|Infinity/);
});

it('distinguishes a nonzero negative series from empty, zero or malformed data', () => {
  const svg = renderChartSvg(data([0, -0, null, NaN, Infinity, -Infinity]), { type: 'pie' }, 500, 300);
  expect(paths(svg)).toHaveLength(0);
  expect(svg).toContain('No nonzero numbers to chart');
  expect(svg).not.toMatch(/NaN|Infinity/);
});
