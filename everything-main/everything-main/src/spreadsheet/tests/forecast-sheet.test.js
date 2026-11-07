import { describe, it, expect } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { readForecastSource, forecastDefaults, createForecastSheet, forecastPreview } from '../src/core/forecast-sheet.js';

const monthly = (y, m) => Math.round((Date.UTC(y, m - 1, 1) - Date.UTC(1899, 11, 30)) / 864e5);
function book(rows, { header = true } = {}) {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  const entries = [];
  if (header) entries.push({ r: 0, c: 0, cell: { v: 'Month' } }, { r: 0, c: 1, cell: { v: 'Sales' } });
  rows.forEach(([x, y], i) => { entries.push({ r: i + (header ? 1 : 0), c: 0, cell: { v: x } }); if (y != null) entries.push({ r: i + (header ? 1 : 0), c: 1, cell: { v: y } }); });
  wb.setCells(id, entries);
  return { wb, id, range: { r1: 0, c1: 0, r2: rows.length - (header ? 0 : 1), c2: 1 } };
}
const SALES = [12, 15, 14, 18, 16, 19, 21, 20, 23, 25, 24, 27];

describe('Forecast Sheet', () => {
  it('reads the timeline and values with their headers', () => {
    const { wb, id, range } = book(SALES.map((v, i) => [monthly(2020, i + 1), v]));
    const src = readForecastSource(wb, id, range);
    expect(src.timelineHeader).toBe('Month');
    expect(src.valuesHeader).toBe('Sales');
    expect(src.points).toHaveLength(12);
    const d = forecastDefaults(src);
    expect(d.start).toBe(monthly(2020, 12));
    expect(d.end).toBe(monthly(2021, 4)); // a third of the history ahead, by calendar months
  });

  it('builds the table, formulas, statistics and chart on a new sheet as one undo step', () => {
    const { wb, id, range } = book(SALES.map((v, i) => [monthly(2020, i + 1), v]));
    const src = readForecastSource(wb, id, range);
    const out = createForecastSheet(wb, src, { start: monthly(2020, 12), end: monthly(2021, 3), confidence: 0.95, statistics: true });
    expect(out.error).toBeUndefined();
    const s = out.sheetId;
    const sheet = wb.sheet(s);
    const text = (r, c) => wb.getValue(s, r, c);
    expect([0, 1, 2, 3, 4].map((c) => text(0, c))).toEqual(['Month', 'Sales', 'Forecast(Sales)', 'Lower Confidence Bound(Sales)', 'Upper Confidence Bound(Sales)']);
    expect(text(12, 2)).toBe(27); // the forecast meets the history at its last point
    expect(text(13, 0)).toBe(monthly(2021, 1));
    expect(text(15, 0)).toBe(monthly(2021, 3));
    expect(wb.getCell(s, 13, 2).f).toBe('FORECAST.ETS(A14,$B$2:$B$13,$A$2:$A$13,1,1,1)');
    expect(wb.getCell(s, 13, 3).f).toBe('C14-FORECAST.ETS.CONFINT(A14,$B$2:$B$13,$A$2:$A$13,0.95,1,1,1)');
    expect(text(13, 2)).toBeCloseTo(27.597215758782, 9); // FORECAST.ETS for this series
    expect(text(13, 4) - text(13, 2)).toBeCloseTo(text(13, 2) - text(13, 3), 9);
    expect(text(1, 6)).toBe('Alpha');
    expect(text(1, 7)).toBe(0.1);
    expect(sheet.charts).toHaveLength(1);
    expect(sheet.charts[0].type).toBe('line');
    expect(sheet.charts[0].sourceRefs.map((r) => r.name)).toEqual(['Sales', 'Forecast(Sales)', 'Lower Confidence Bound(Sales)', 'Upper Confidence Bound(Sales)']);
    expect(sheet.tables.length).toBe(2);
    const sheets = wb.sheets.length;
    wb.undo();
    expect(wb.sheets.length).toBe(sheets - 1);
  });

  it('fits only the history up to an earlier forecast start', () => {
    const { wb, id, range } = book(SALES.map((v, i) => [i + 1, v]), { header: false });
    const src = readForecastSource(wb, id, range);
    expect(src.valuesHeader).toBe('Values');
    const out = createForecastSheet(wb, src, { start: 10, end: 14, showConfidence: false, chartType: 'column' });
    const s = out.sheetId;
    expect(wb.getCell(s, 11, 2).f).toBe('FORECAST.ETS(A12,$B$2:$B$11,$A$2:$A$11,1,1,1)');
    expect(wb.getValue(s, 10, 2)).toBe(25);
    expect(wb.getValue(s, 14, 0)).toBe(14);
    expect(wb.sheet(s).charts[0].type).toBe('column');
    expect(wb.getValue(s, 0, 3)).toBe(null);
  });

  it('previews the forecast the sheet will hold and refuses what cannot be forecast', () => {
    const { wb, id, range } = book(SALES.map((v, i) => [i + 1, v]), { header: false });
    const src = readForecastSource(wb, id, range);
    const pv = forecastPreview(src, { start: 12, end: 14 });
    expect(pv.points).toHaveLength(14);
    expect(pv.points[12].forecast).toBeCloseTo(27.597215758782, 9);
    expect(forecastPreview(src, { start: 12, end: 12 }).error).toBeTruthy();
    const one = book([[1, 'a'], [2, 'b']], { header: false });
    expect(readForecastSource(one.wb, one.id, one.range).error).toBeTruthy();
  });
});
