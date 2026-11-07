import { expect, it } from 'vitest';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { chartData } from '../src/core/charts.js';
import { renderChartSvg } from '../src/ui/chartsvg.js';
import { regionalChartXlsx } from './helpers/xlsx-regional-chart-fixture.js';

const labelPoints = svg => [...svg.matchAll(/<text x="([^"]+)" y="([^"]+)"[^>]*class="chart-data-label">([^<]+)<\/text>/g)]
  .map(m => ({ x: +m[1], y: +m[2], text: m[3] }));

it('imports line/scatter charts with live named coordinates, endpoint labels, and Trebuchet dimensions through save/reopen', async () => {
  let wb = await workbookFromFile(regionalChartXlsx(), 'regions.xlsx');
  for (let pass = 0; pass < 2; pass++) {
    const sheet = wb.sheets[0], chart = sheet.charts[0], data = chartData(wb, sheet.id, chart);
    expect(chart).toMatchObject({ type: 'combo', yMin: 0, w: 1168, h: 313, appearance: {
      seriesTypes: ['line', 'line', 'line', 'scatter', 'scatter'], categoryBetween: false, background: 'none', xStyle: { font: 'trebuchet' } } });
    expect(wb.colWidth(sheet.id, 0)).toBe(134);
    expect(wb.colWidth(sheet.id, 1)).toBe(94);
    expect(wb.rowHeight(sheet.id, 1)).toBe(351);
    expect(chart.sourceRefs[3]).toMatchObject({ categories: 'x', values: 'y' });
    expect(data.categories).toEqual(['JAN', 'FEB', 'MAR', 'APR']);
    expect(data.series[0].values).toEqual([23000, 25000, null, null]);
    expect(data.series[3].x).toEqual([2, 2, 0, null]);
    expect(data.series[3].values.slice(0, 2)).toEqual([25000, 18000]);
    expect(data.series[3].values[2]).toBeLessThan(-1e190);
    expect(data.series[4].x[0]).toBe(6);
    const svg = renderChartSvg(data, chart, 1000, 300), labels = labelPoints(svg);
    expect(svg.match(/<path class="chart-series"/g)).toHaveLength(2);
    expect(labels.map(l => l.text)).toEqual(['North', 'South']);
    const plot = svg.match(/<clipPath[^>]*><rect x="([^"]+)" y="[^"]+" width="([^"]+)"/);
    // Manual plots still reserve room for value labels. The series endpoint
    // stays one fifth across the resulting plot, followed by its label offset.
    expect(labels[0].x).toBeCloseTo(+plot[1] + +plot[2] / 5 + 6, 1);
    expect(svg).toContain('>$25,000</text>');
    expect(svg).not.toMatch(/NaN|Infinity|STALE|chart-column/);
    if (!pass) wb = await workbookFromFile(await workbookToXlsx(wb), 'saved.xlsx');
  }
  const sheet = wb.sheets[0], chart = sheet.charts[0];
  const render = () => renderChartSvg(chartData(wb, sheet.id, chart), chart, 1000, 300);
  const original = labelPoints(render());
  wb.setInput(sheet.id, 3, 3, '27000');
  expect(chartData(wb, sheet.id, chart).series[3].x[0]).toBe(3);
  expect(chartData(wb, sheet.id, chart).series[3].values[0]).toBe(27000);
  expect(labelPoints(render())[0].x).toBeGreaterThan(original[0].x);
  wb.undo();
  expect(labelPoints(render())).toEqual(original);
  wb.setInput(sheet.id, 5, 0, 'West');
  expect(labelPoints(render()).map(l => l.text)).not.toContain('West'); // unused sentinel remains off-plot
  wb.setInput(sheet.id, 5, 1, '10000');
  expect(labelPoints(render()).map(l => l.text)).toEqual(['North', 'South', 'West']);
  const recolored = { ...chart, colors: ['#123456', ...chart.colors.slice(1)] };
  expect(renderChartSvg(chartData(wb, sheet.id, recolored), recolored, 1000, 300)).toContain('stroke="#123456"');
});

it('does not silently put a scatter group on a different axis into the shared-axis model', async () => {
  const wb = await workbookFromFile(regionalChartXlsx({ secondary: true }), 'regions.xlsx');
  expect(wb.sheets[0].charts).toEqual([]);
});
