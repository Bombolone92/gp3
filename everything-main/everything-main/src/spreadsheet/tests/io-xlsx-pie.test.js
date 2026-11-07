import { expect, it } from 'vitest';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { chartData, normalizeChart } from '../src/core/charts.js';
import { renderChartSvg } from '../src/ui/chartsvg.js';
import { intersectTableFormula } from '../src/core/xlsx-table-formulas.js';
import { pieXlsx } from './helpers/xlsx-pie-fixture.js';

it('imports live doughnuts with point colors, borders, label fields and the ring size from the file', async () => {
  let wb = await workbookFromFile(pieXlsx(), 'plan.xlsx');
  for (let pass = 0; pass < 2; pass++) {
    const sheet = wb.sheets[0], chart = sheet.charts[0];
    expect(wb.sheets[1].hidden).toBe(true);
    expect(wb.getCell(sheet.id, 1, 1).s.font).toBe('segoe');
    expect(chart).toMatchObject({ type: 'donut', anchor: { r: 1, c: 1 }, dx: 1, dy: 2, h: 598,
      appearance: { background: 'none', border: false, plot: { x: .15, y: .06, w: .7, h: .8 },
        pie: { holeSize: 25, firstSliceAngle: 45, labels: { category: true, value: true, percent: false } } } });
    expect(chart.appearance.pointColors[0][0].color).toMatch(/^#[a-f0-9]{6}$/);
    expect(chart.appearance.pie.points[0]).toMatchObject({ stroke: '#ffffff', strokeWidth: 2 });
    expect(chart.appearance.pie.labels.points[1]).toMatchObject({ index: 3, style: { font: 'segoe', color: '#262626' }, content: [{ kind: 'category' }, { kind: 'text', text: '\n' }, { kind: 'value' }] });
    const data = chartData(wb, sheet.id, chart);
    expect(data.series[0].values).toEqual([900, 240, 10, 850]);
    const svg = renderChartSvg(data, chart, chart.w, chart.h);
    expect(svg.match(/class="chart-data-label"/g)).toHaveLength(4);
    expect(svg.match(/fill-rule="evenodd"/g)).toHaveLength(4);
    expect(svg).toContain('stroke="#ffffff" stroke-width="2"');
    expect(svg).toContain('>$850</tspan>');
    expect(svg).toContain('>Savings</tspan>');
    expect(svg).toContain('font-family="&quot;Segoe UI&quot;');
    expect(svg).not.toMatch(/NaN|Infinity|\[\]|\$999/);
    if (!pass) wb = await workbookFromFile(await workbookToXlsx(wb), 'reopened.xlsx');
  }
  const sheet = wb.sheets[0], chart = sheet.charts[0];
  wb.setInput(sheet.id, 6, 2, '1000');
  expect(chartData(wb, sheet.id, chart).series[0].values).toEqual([1000, 240, 10, 750]);
  wb.setInput(sheet.id, 7, 3, 'Monthly');
  expect(chartData(wb, sheet.id, chart).series[0].values).toEqual([1000, 60, 10, 930]);
  wb.undo();
  expect(chartData(wb, sheet.id, chart).series[0].values[3]).toBe(750);
});

it('intersects legacy scalar table formulas before ROUND without truncating aggregate ranges', async () => {
  const wb = await workbookFromFile(pieXlsx(), 'ledger.xlsx'), sheet = wb.sheets[0];
  expect(wb.getValue(sheet.id, 6, 4)).toBe(900);
  expect(wb.getValue(sheet.id, 7, 4)).toBe(240);
  expect(wb.getValue(sheet.id, 8, 4)).toBe(10);
  expect(wb.getValue(sheet.id, 6, 5)).toBeCloseTo(900 / 1150);
  expect(wb.getCell(sheet.id, 6, 4).f).toContain('@Ledger[Amount]');
  const r = wb.addTableRow(sheet.id, sheet.tables[0].id);
  wb.setInput(sheet.id, r, 2, '123');
  wb.setInput(sheet.id, r, 3, 'Monthly');
  expect(wb.getValue(sheet.id, r, 4)).toBe(123);
  expect(wb.getValue(sheet.id, r, 5)).toBeCloseTo(123 / 1273);
  expect(wb.getValue(sheet.id, 1, 6)).toBe(727);
});

it('preserves explicit arrays, @ references, strings, and range-consuming formula arguments', async () => {
  const cases = [
    ['IF(Items[Cost]>0,ROUND(Items[Cost]/12,0),0)', 'IF(@Items[Cost]>0,ROUND(@Items[Cost]/12,0),0)'],
    ['IFERROR(Items[Cost]*2,0)+SUM(Items[Cost])', 'IFERROR(@Items[Cost]*2,0)+SUM(Items[Cost])'],
    ['SUMPRODUCT(ROUND(Items[Cost],0),Items[Qty])', 'SUMPRODUCT(ROUND(Items[Cost],0),Items[Qty])'],
    ['SUMIF(Items[Name],"Rent",Items[Cost])', 'SUMIF(Items[Name],"Rent",Items[Cost])'],
    ['INDEX(Items[Cost],2)', 'INDEX(Items[Cost],2)'],
    ['@Items[Cost]+Items[@Cost]+Items[[#This Row],[Cost]]', '@Items[Cost]+Items[@Cost]+Items[[#This Row],[Cost]]'],
    ['IF(TRUE,"Items[Cost]",[Cost])', 'IF(TRUE,"Items[Cost]",@[Cost])'],
  ];
  for (const [source, expected] of cases) expect(intersectTableFormula(source)).toBe(expected);
  for (const options of [{ arrayColumn: true }, { arrayCell: true }]) {
    const wb = await workbookFromFile(pieXlsx(options), 'array.xlsx');
    expect(wb.getCell(wb.sheets[0].id, 6, 4).f).not.toContain('@Ledger[Amount]');
    if (options.arrayColumn) expect(wb.sheets[0].tables[0].calc[3]).not.toContain('@Ledger[Amount]');
  }
});

it('supports pies and tracks renamed chart sources without partially importing multiple rings', async () => {
  const wb = await workbookFromFile(pieXlsx({ type: 'pieChart' }), 'pie.xlsx'), sheet = wb.sheets[0], helper = wb.sheets[1];
  wb.renameSheet(helper.id, 'Renamed helper');
  wb.insertRows(helper.id, 0, 2);
  const chart = sheet.charts[0];
  expect(chart.sourceRefs[0].values).toBe("'Renamed helper'!$B$3:$B$6");
  const svg = renderChartSvg(chartData(wb, sheet.id, chart), chart, chart.w, chart.h);
  expect(svg).toContain('>$850</tspan>');
  expect(svg).not.toContain('fill-rule="evenodd"');
  const multiple = await workbookFromFile(pieXlsx({ editChart: xml => xml.replace('</c:ser>', '</c:ser><c:ser/>') }), 'rings.xlsx');
  expect(multiple.sheets[0].charts).toEqual([]);
});

it('bounds imported pie metadata and escapes custom label text', async () => {
  const wb = await workbookFromFile(pieXlsx(), 'pie.xlsx'), sheet = wb.sheets[0], original = sheet.charts[0];
  const chart = normalizeChart({ ...original, appearance: { ...original.appearance, pie: { holeSize: Infinity, firstSliceAngle: 999,
    stroke: 'url(bad)', labels: { style: { size: Infinity, color: 'url(bad)' }, content: [{ kind: 'text', text: '<script>' }],
      points: [{ index: -1 }, { index: 0, dx: 999, dy: NaN, hidden: true }] } } } });
  expect(chart.appearance.pie).toMatchObject({ holeSize: 50, firstSliceAngle: 360, stroke: null, labels: { style: { size: 16, color: '#000000' }, points: [{ index: 0, dx: 1, dy: 0 }] } });
  const svg = renderChartSvg(chartData(wb, sheet.id, chart), chart, 600, 400);
  expect(svg).toContain('&lt;script&gt;');
  expect(svg.match(/class="chart-data-label"/g)).toHaveLength(3);
  expect(svg).not.toMatch(/NaN|Infinity|<script>|url\(bad\)/);
});

it('honors percentage formats and per-point label suppression', async () => {
  const wb = await workbookFromFile(pieXlsx({ editChart: xml => xml
    .replace('<c:showCatName val="1"/>', '<c:showCatName val="0"/>')
    .replace('<c:showVal val="1"/>', '<c:showVal val="0"/>')
    .replace('<c:showPercent val="0"/>', '<c:showPercent val="1"/><c:numFmt formatCode="0.0%" sourceLinked="0"/>')
    .replace('<c:dLbl><c:idx val="3"/>', '<c:dLbl><c:idx val="3"/><c:delete val="1"/>') }), 'percent.xlsx');
  const sheet = wb.sheets[0], chart = sheet.charts[0], svg = renderChartSvg(chartData(wb, sheet.id, chart), chart, 600, 400);
  expect(svg.match(/class="chart-data-label"/g)).toHaveLength(3);
  expect(svg).toContain('>45.0%</tspan>');
  expect(svg).toContain('>12.0%</tspan>');
  expect(svg).toContain('>0.5%</tspan>');
});
