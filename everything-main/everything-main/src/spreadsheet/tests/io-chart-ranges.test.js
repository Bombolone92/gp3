import { afterEach, describe, expect, it, vi } from 'vitest';
import * as XLSX from '../src/vendor/xlsx.mjs';
import { META_SHEET, workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { chartData } from '../src/core/charts.js';
import { MAX_ROW, MAX_COL } from '../src/core/refs.js';

afterEach(() => vi.restoreAllMocks());

async function importCharts(ranges) {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([[42]]), 'Data');
  const charts = ranges.map((range) => ({ type: 'column', range, anchor: { r: 0, c: 2 } }));
  const json = JSON.stringify({ v: 1, sheets: { Data: { charts } } });
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([[json]]), META_SHEET);
  return workbookFromFile(XLSX.write(book, { type: 'array', bookType: 'xlsx' }), 'charts.xlsx');
}

describe('imported chart ranges', () => {
  it.each(['r1', 'c1'])('rejects hostile %s bounds before evaluating chart data', async (field) => {
    const valid = { r1: 0, c1: 0, r2: 0, c2: 0 };
    const wb = await importCharts([valid, { ...valid, [field]: -1e100 }]);
    const getValue = wb.getValue.bind(wb);
    let calls = 0;
    // Fail promptly if a malformed range drives a nonterminating loop.
    vi.spyOn(wb, 'getValue').mockImplementation((...args) => {
      if (++calls > 20) throw new Error('Chart exceeded its iteration budget');
      return getValue(...args);
    });
    expect(() => wb.activeSheet.charts.map((chart) => chartData(wb, wb.activeSheetId, chart))).not.toThrow();
    expect(wb.activeSheet.charts).toHaveLength(1);
    expect(wb.getValue(wb.activeSheetId, 0, 0)).toBe(42);
    const back = await workbookFromFile(await workbookToXlsx(wb), 'saved.xlsx');
    expect(back.activeSheet.charts).toHaveLength(1);
    expect(chartData(back, back.activeSheetId, back.activeSheet.charts[0]).series[0].values).toEqual([42]);
  });

  it('drops invalid coordinates and preserves reversed ranges at the format limits', async () => {
    const valid = { r1: MAX_ROW, c1: MAX_COL, r2: 0, c2: 0 };
    const wb = await importCharts([
      valid, {}, { ...valid, r1: MAX_ROW + 1 }, { ...valid, c1: MAX_COL + 1 },
      { ...valid, r1: 0.5 }, { ...valid, c1: 'bad' }, { ...valid, c2: null },
    ]);
    expect(wb.activeSheet.charts.map((chart) => chart.range)).toEqual([{ r1: 0, c1: 0, r2: MAX_ROW, c2: MAX_COL }]);
  });
});
