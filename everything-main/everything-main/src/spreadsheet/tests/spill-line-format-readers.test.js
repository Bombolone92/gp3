// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { buildPrintTable } from '../src/ui/print.js';
import { chartData, defaultChart } from '../src/core/charts.js';
import { renderChartSvg } from '../src/ui/chartsvg.js';

function book(axis) {
  const line = { fmt: 'percent', dec: 1, bold: true, bg: '#ffff00' };
  return new Workbook({ sheets: [{ name: 'Prices',
    ...(axis === 'col' ? { colStyles: { 0: line } } : { rowStyles: { 1: line, 2: line } }),
    cells: { '0,0': { f: 'SEQUENCE(3)', s: { fmt: 'currency', cur: 'USD', dec: 2 } } },
  }] });
}
const range = { r1: 1, c1: 0, r2: 2, c2: 0 };

it.each(['col', 'row'])('prints spilled numbers as displayed over a %s format, keeping fills and cell overrides', (axis) => {
  const wb = book(axis), id = wb.activeSheetId;
  const printed = () => [...buildPrintTable(wb, id, { range }).querySelectorAll('td')];
  expect([1, 2].map((r) => wb.getDisplay(id, r, 0))).toEqual(['$2.00', '$3.00']);
  expect(printed().map((td) => td.textContent)).toEqual(['$2.00', '$3.00']);
  expect(printed()[0].style.backgroundColor).toBe('rgb(255, 255, 0)');
  expect(printed()[0].style.fontWeight).toBe('600');
  wb.applyStyle(id, { ...range, r2: 1 }, { fmt: 'number', dec: 3, group: false });
  expect(printed().map((td) => td.textContent)).toEqual(['2.000', '$3.00']);
  wb.undo();
  expect(printed().map((td) => td.textContent)).toEqual(['$2.00', '$3.00']);
});

it.each(['col', 'row'])('charts spilled numbers in their displayed format over a %s format', (axis) => {
  const wb = book(axis), id = wb.activeSheetId;
  const chart = { ...defaultChart(range, { r: 0, c: 3 }), legend: false };
  const data = chartData(wb, id, chart);
  expect(data.series[0].values).toEqual([2, 3]);
  expect(data.valueStyle).toMatchObject({ fmt: 'currency', cur: 'USD', dec: 2 });
  const svg = renderChartSvg(data, chart, 480, 300);
  expect(svg).toContain('Series 1 · 1: $2.00');
  expect(svg).toContain('Series 1 · 2: $3.00');
  wb.applyStyle(id, range, { fmt: 'percent', dec: 3 });
  expect(chartData(wb, id, chart).valueStyle).toMatchObject({ fmt: 'percent', dec: 3 });
});

it('keeps spilled dates as chart categories when the underlying column is numeric', () => {
  const wb = new Workbook({ sheets: [{ name: 'Dates', colStyles: { 0: { fmt: 'number' } },
    cells: { '0,0': { f: 'SEQUENCE(3,1,45293)', s: { fmt: 'date', dateStyle: 'iso' } },
      '1,1': { v: 10 }, '2,1': { v: 20 } },
  }] });
  const data = chartData(wb, wb.activeSheetId, defaultChart({ ...range, c2: 1 }, { r: 0, c: 3 }));
  expect(data.categories).toEqual(['2024-01-03', '2024-01-04']);
  expect(data.series.map((s) => s.values)).toEqual([[10, 20]]);
});
