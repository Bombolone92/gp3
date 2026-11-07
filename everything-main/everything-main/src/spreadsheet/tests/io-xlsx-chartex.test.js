import { expect, it } from 'vitest';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { chartData, imageTransform, normalizeChart } from '../src/core/charts.js';
import { renderChartSvg } from '../src/ui/chartsvg.js';
import { chartExXlsx } from './helpers/xlsx-chartex-fixture.js';

it('imports ChartEx Pareto owners, named sources, transparent fill and artwork through save/reopen', async () => {
  let wb = await workbookFromFile(chartExXlsx(), 'defects.xlsx');
  for (let pass = 0; pass < 2; pass++) {
    const sheet = wb.sheets[0], [chart, image, shape] = sheet.charts;
    expect(sheet.charts).toHaveLength(3); // no hidden owner/line or fallback warning
    expect(chart).toMatchObject({ type: 'combo', pareto: true, secondaryAxis: true, legend: false,
      sourceRefs: [{ values: '_xlchart.v1.3' }], colors: ['#e95a29', '#26a6fc'],
      appearance: { background: 'none', border: false, gapWidth: 100, y2Min: 0, y2Max: 1, y2Step: .1, y2Format: '0%', xStyle: { font: 'avenir' } } });
    expect(imageTransform(image)).toBe('rotate(180deg)');
    expect(shape).toMatchObject({ type: 'text', text: '', w: 100, h: 400, style: { bg: '#3c9fe0', border: false } });
    const data = chartData(wb, sheet.id, chart);
    expect(data.series.map(s => s.values)).toEqual([[20, 10, 5], [20 / 35, 30 / 35, 1]]);
    const svg = renderChartSvg(data, chart, 1000, 600);
    expect(svg.match(/class="chart-series chart-column"/g)).toHaveLength(3);
    expect(svg.match(/<path class="chart-series"/g)).toHaveLength(1);
    expect(svg).toContain('>100%</text>');
    expect(svg).toContain('fill="none"');
    expect(svg).not.toContain('<circle');
    if (!pass) wb = await workbookFromFile(await workbookToXlsx(wb), 'saved.xlsx');
  }
});

it('aggregates and sorts live counts, recalculates cumulative shares, and follows named sources through edits', async () => {
  const wb = await workbookFromFile(chartExXlsx(), 'defects.xlsx'), id = wb.sheets[0].id;
  const data = () => chartData(wb, id, wb.sheet(id).charts[0]);
  wb.setInput(id, 4, 1, '40');
  expect(data().categories).toEqual(['Salaries', 'Parts and materials', 'Manufacturing equipment']);
  expect(data().series.map(s => s.values)).toEqual([[40, 20, 10], [40 / 70, 60 / 70, 1]]);
  wb.undo();
  wb.setInput(id, 4, 0, 'Parts and materials');
  expect(data().series.map(s => s.values)).toEqual([[25, 10], [25 / 35, 1]]);
  wb.undo();
  wb.setHidden(id, 'row', [2], true);
  expect(data().series.map(s => s.values)).toEqual([[10, 5], [10 / 15, 1]]);
  wb.undo();
  wb.renameSheet(id, 'Defect data');
  wb.insertRows(id, 0, 2);
  expect(data().series[0].values).toEqual([20, 10, 5]);
  wb.setInput(id, 4, 1, '0'); wb.setInput(id, 5, 1, '0'); wb.setInput(id, 6, 1, '0');
  expect(data().series[1].values).toEqual([null, null, null]);
  expect(renderChartSvg(data(), wb.sheet(id).charts[0], 1000, 600)).not.toMatch(/NaN|Infinity/);
});

it('skips external ChartEx relationships and unsupported extended chart layouts', async () => {
  for (const options of [{ external: true }, { layout: 'waterfall' }, { aggregate: false }]) {
    const wb = await workbookFromFile(chartExXlsx(options), 'unsupported.xlsx');
    expect(wb.sheets[0].charts.map(c => c.type)).toEqual(['image', 'text']);
  }
  const image = { type: 'image', anchor: { r: 0, c: 0 }, src: 'data:image/png;base64,AA==', rotation: -180, flipH: true };
  expect(imageTransform(normalizeChart(image))).toBe('rotate(180deg) scale(-1, 1)');
  expect(imageTransform(normalizeChart({ ...image, rotation: Infinity, flipH: false }))).toBe('');
});
