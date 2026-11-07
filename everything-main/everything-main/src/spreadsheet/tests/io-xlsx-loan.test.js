import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { chartData, normalizeChart } from '../src/core/charts.js';
import { renderChartSvg } from '../src/ui/chartsvg.js';
import { ymdToSerial } from '../src/core/format.js';
import { xlsxColor } from '../src/core/xlsx-styles.js';
import { loanXlsx } from './helpers/xlsx-loan-fixture.js';
import { sameBook } from '../src/lib/drafts.js';

const svgOf = (wb, chart) => renderChartSvg(chartData(wb, wb.activeSheetId, chart), chart, chart.w, chart.h);

it('opens live loan charts with calendar years, ordinal scatter coordinates and custom colors, including after save/reopen', async () => {
  let wb = await workbookFromFile(loanXlsx(), 'loan.xlsx');
  for (let pass = 0; pass < 2; pass++) {
    const sheet = wb.sheets[0], [balance, rate] = sheet.charts;
    expect(sheet.charts).toHaveLength(2);
    expect(balance).toMatchObject({ h: 272, includeHidden: true, appearance: { dateAxis: true, xTimeUnit: 'years', xStep: 2, xRotation: -90 } });
    expect(rate).toMatchObject({ type: 'scatter', xTitle: 'Installment', sourceRefs: [{ categories: "'Loan Model'!$B$9:$B$81", categoryMode: 'ordinal' }], appearance: { xMin: 0, xMax: 160, xStep: 40, yFormat: '0.00%' } });
    const data = chartData(wb, sheet.id, rate);
    expect(data.series[0].x).toEqual(Array.from({ length: 72 }, (_, i) => i + 1));
    expect(data.series[0].values).toEqual(Array(72).fill(.06));
    expect(chartData(wb, sheet.id, balance).series[0].values[0]).toBeGreaterThan(11000);
    const svg = svgOf(wb, balance), years = [...svg.matchAll(/>(20\d\d)<\/text>/g)].map(m => m[1]);
    expect(years).toEqual(['2024', '2026', '2028']);
    expect(svg).toContain('rotate(-90 ');
    // A narrow manual legend lays its long entries on separate lines inside the chart.
    const entries = [...svg.matchAll(/<text x="([^"]+)" y="([^"]+)"[^>]*>(Remaining loan|Scheduled balance)<\/text>/g)];
    expect(entries).toHaveLength(2);
    expect(entries[0][1]).toBe(entries[1][1]);
    expect(+entries[1][2]).toBeGreaterThan(+entries[0][2]);
    expect(svgOf(wb, rate)).toContain('>6.00%</text>');
    expect(svgOf(wb, rate)).not.toMatch(/NaN|Infinity/);
    expect(wb.styleAt(sheet.id, 2, 1)).toMatchObject({ bg: { indexed: 43, base: '#fff4bb', rgb: '#fff4bb' }, color: { indexed: 8, base: '#003366', rgb: '#003366' }, bb: true, bc: '#5f5f5f' });
    expect(wb.conditionalStyle(sheet.id, 2, 1)?.bg).toBeUndefined();
    if (!pass) wb = await workbookFromFile(await workbookToXlsx(wb), 'saved.xlsx');
  }
  const sheet = wb.sheets[0], [balance, rate] = sheet.charts;
  const original = chartData(wb, sheet.id, balance).series[0].values[10];
  wb.setInput(sheet.id, 2, 1, '25');
  expect(chartData(wb, sheet.id, balance).series[0].values[10]).toBeCloseTo(original - 275);
  wb.undo();
  expect(chartData(wb, sheet.id, balance).series[0].values[10]).toBe(original);
  wb.setInput(sheet.id, 3, 1, '1');
  expect(chartData(wb, sheet.id, rate).series[0].values[36]).toBeCloseTo(.07);
  expect(wb.conditionalStyle(sheet.id, 2, 1)).toMatchObject({ bg: 'transparent', color: 'windowtext' });
  wb.undo();
  expect(chartData(wb, sheet.id, rate).series[0].values[36]).toBe(.06);
});

it('preserves short default and explicit row heights in drafts, row edits and native XLSX output', async () => {
  let wb = await workbookFromFile(loanXlsx(), 'loan.xlsx');
  wb = new Workbook(wb.toJSON());
  const id = wb.activeSheetId;
  expect(wb.sheet(id).defaultRowHeight).toBe(17);
  expect([0, 1, 2, 5, 6, 5000].map(r => wb.rowHeight(id, r))).toEqual([40, 26, 17, 12, 0, 17]);
  const draft = wb.toJSON();
  wb.setRowHeight(id, 2, 26);
  expect(wb.rowHeight(id, 2)).toBe(26);
  expect(sameBook(draft, wb.toJSON())).toBe(false);
  wb.undo();
  expect(wb.rowHeight(id, 2)).toBe(17);
  expect(sameBook(draft, wb.toJSON())).toBe(true);
  wb.setRowHeight(id, 2, 18);
  expect(sameBook(draft, wb.toJSON())).toBe(false);
  wb.undo();
  wb.insertRows(id, 2);
  expect(wb.rowHeight(id, 2)).toBe(17);
  expect(wb.rowHeight(id, 6)).toBe(12);
  wb.undo();
  const saved = await workbookToXlsx(wb), zip = X.CFB.read(new Uint8Array(await saved.arrayBuffer()), { type: 'array' });
  const xml = new TextDecoder().decode(X.CFB.find(zip, '/xl/worksheets/sheet1.xml').content);
  expect(xml).toContain('defaultRowHeight="12.75"');
  const back = await workbookFromFile(saved, 'saved.xlsx');
  expect([0, 1, 2, 5, 6, 5000].map(r => back.rowHeight(back.activeSheetId, r))).toEqual([40, 26, 17, 12, 0, 17]);
});

it('uses numeric scatter X coordinates and marker-only series when specified by the file', async () => {
  const wb = await workbookFromFile(loanXlsx({ numericX: true, markerOnly: true }), 'scatter.xlsx'), rate = wb.sheets[0].charts[1];
  expect(chartData(wb, wb.activeSheetId, rate).series[0].x).toEqual(Array.from({ length: 72 }, (_, i) => (i + 1) * 2));
  const svg = svgOf(wb, rate);
  expect(svg).not.toContain('<path class="chart-series"');
  const circles = [...svg.matchAll(/<circle\b[^>]*\bcx="([^"]+)"/g)].map(m => +m[1]);
  expect(circles).toHaveLength(72);
  expect(circles[0]).toBeCloseTo(72 + 384 * 2 / 160, 2);
  expect(circles.at(-1)).toBeCloseTo(72 + 384 * 144 / 160, 2);
});

it.each([
  ['months', [2024, 1, 31], [2024, 4, 30], ['2024-01-31', '2024-02-29', '2024-03-31', '2024-04-30']],
  ['years', [2024, 2, 29], [2028, 2, 29], ['2024-02-29', '2025-02-28', '2026-02-28', '2027-02-28', '2028-02-29']],
])('spaces %s date ticks by the calendar across month ends and leap years', (unit, first, last, expected) => {
  const chart = normalizeChart({ type: 'line', anchor: { r: 0, c: 0 }, range: { r1: 0, c1: 0, r2: 1, c2: 1 }, appearance: { dateAxis: true, xTimeUnit: unit, xStep: 1, xFormat: 'yyyy-mm-dd' } });
  const svg = renderChartSvg({ categories: ['Start', 'End'], x: [ymdToSerial(...first), ymdToSerial(...last)], series: [{ name: 'Amount', values: [10, 5] }] }, chart, 700, 300);
  expect([...svg.matchAll(/>(\d{4}-\d{2}-\d{2})<\/text>/g)].map(m => m[1])).toEqual(expected);
});

it('resolves the standard indexed palette when no workbook palette is supplied', () => {
  expect(xlsxColor('<color indexed="18"/>')).toBe('#000080');
  expect(xlsxColor('<color indexed="43"/>')).toBe('#ffff99');
  expect(xlsxColor('<color indexed="64"/>')).toBeNull();
});
