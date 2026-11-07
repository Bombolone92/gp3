import { expect, it } from 'vitest';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { chartData } from '../src/core/charts.js';
import { renderChartSvg } from '../src/ui/chartsvg.js';
import { paretoXlsx } from './helpers/xlsx-pareto-fixture.js';

it('preserves a Pareto report, both axes, live series, two-cell anchors and embedded artwork through save/reopen', async () => {
  let wb = await workbookFromFile(paretoXlsx(), 'pareto.xlsx');
  for (let pass = 0; pass < 2; pass++) {
    const sheet = wb.sheets[0], [chart, image] = sheet.charts;
    expect(wb.colWidth(sheet.id, 0)).toBe(345); // Garamond 11: seven-pixel digits, not the vendor's guessed 14
    expect(wb.colWidth(sheet.id, 3)).toBe(893); // wider than the app's interactive resize cap
    expect(wb.getCell(sheet.id, 0, 0).s).toMatchObject({ font: 'aharoni', size: 96, bold: true });
    expect(chart).toMatchObject({ type: 'combo', anchor: { r: 2, c: 3 }, dx: 10, dy: 4, w: 700, secondaryAxis: true,
      colors: ['#273e55', '#f3aea7'], appearance: { background: '#fbe4e2', border: false, y2Max: 1, y2Format: '0.00%', gapWidth: 269 } });
    expect(chart.h).toBeCloseTo(169.6);
    expect(image).toMatchObject({ type: 'image', anchor: { r: 0, c: 3 }, dx: 40, dy: 10, w: 600, h: 170, flipH: true, border: false, title: 'Cost analysis illustration' });
    expect(image.src).toMatch(/^data:image\/png;base64,iVBOR/);
    const data = chartData(wb, sheet.id, chart);
    expect(data.categories).toEqual(['Parts and materials', 'Manufacturing equipment', 'Salaries']);
    expect(data.series.map(s => s.values)).toEqual([[20, 10, 5], [20 / 35, 30 / 35, 1]]);
    const svg = renderChartSvg(data, chart, chart.w, chart.h);
    expect(svg.match(/class="chart-series chart-column"/g)).toHaveLength(3);
    expect(svg.match(/<path class="chart-series"/g)).toHaveLength(1);
    expect(svg).toContain('>100.00%</text>');
    expect(svg).toContain('>$20.00</text>');
    // These labels stay horizontal. A narrow word-wrapped label must
    // not trigger the old whole-string-width rotation heuristic.
    expect(svg).not.toContain('rotate(-45');
    expect(svg).toContain('aria-label="Manufacturing equipment"');
    if (!pass) wb = await workbookFromFile(await workbookToXlsx(wb), 'saved.xlsx');
  }
  const sheet = wb.sheets[0], chart = sheet.charts[0];
  wb.setInput(sheet.id, 2, 1, '40');
  expect(chartData(wb, sheet.id, chart).series.map(s => s.values)).toEqual([[40, 10, 5], [40 / 55, 50 / 55, 1]]);
  wb.undo();
  expect(chartData(wb, sheet.id, chart).series[1].values).toEqual([20 / 35, 30 / 35, 1]);
});

it('resolves axes by ID instead of XML order and skips external picture relationships', async () => {
  const wb = await workbookFromFile(paretoXlsx({ reverseAxes: true, externalImage: true }), 'axes.xlsx');
  expect(wb.sheets[0].charts).toHaveLength(1);
  expect(wb.sheets[0].charts[0]).toMatchObject({ secondaryAxis: true, yMax: null, appearance: { yFormat: '$#,##0.00', y2Max: 1 } });
});

it('imports a native column chart without inventing a line or a secondary axis', async () => {
  const wb = await workbookFromFile(paretoXlsx({ columnOnly: true }), 'columns.xlsx'), sheet = wb.sheets[0], chart = sheet.charts[0];
  expect(chart).toMatchObject({ type: 'column', secondaryAxis: false });
  const svg = renderChartSvg(chartData(wb, sheet.id, chart), chart, 700, 400);
  expect(svg.match(/class="chart-series chart-column"/g)).toHaveLength(3);
  expect(svg).not.toContain('<path class="chart-series"');
});
