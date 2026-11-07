import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

// SUBTOTAL and AGGREGATE read the formula text of every cell of their range, to leave out the
// nested subtotals among them, and ask whether each row is hidden. Both looked the sheet up by
// name for every cell — a walk of every sheet in the book, re-reading each name — so one
// =SUBTOTAL(9,Data!A1:A20000) on another sheet cost forty thousand of those walks, and a totals
// row of ten cost a second on every edit.

function book(rows, extraSheets = 9) {
  const cells = {};
  for (let r = 0; r < rows; r++) cells[`${r},0`] = { v: 1 };
  const sheets = [{ name: 'Data', rows: rows + 10, cols: 4, cells }];
  for (let i = 0; i < extraSheets; i++) sheets.push({ name: `Filler${i}`, rows: 10, cols: 4, cells: {} });
  sheets.push({ name: 'Report', rows: 10, cols: 4, cells: {} });
  const wb = new Workbook({ sheets });
  return { wb, data: wb.sheetByName('Data').id, report: wb.sheetByName('Report').id };
}

/** How many times the workbook looked a sheet up by name while `run` ran. */
function lookups(wb, run) {
  let calls = 0;
  const byName = wb.sheetByName.bind(wb);
  wb.sheetByName = (name) => { calls++; return byName(name); };
  try { run(); } finally { delete wb.sheetByName; }
  return calls;
}

describe('a cross-sheet SUBTOTAL over a long column', () => {
  it('looks its sheet up once, not once per cell', { timeout: 60000 }, () => {
    const rows = 20000;
    for (const formula of [`SUBTOTAL(9,Data!A1:A${rows})`, `AGGREGATE(9,0,Data!A1:A${rows})`, `SUM(Data!A1:A${rows})`]) {
      const { wb, report } = book(rows);
      wb.setInput(report, 0, 0, `=${formula}`);
      const calls = lookups(wb, () => expect(wb.getValue(report, 0, 0)).toBe(rows));
      expect(calls).toBeLessThan(20);
    }
  });

  it('still leaves out the rows a filter hides and the nested subtotals', () => {
    const { wb, data, report } = book(10);
    wb.setInput(data, 3, 0, `=SUBTOTAL(9,A1:A3)`); // a nested subtotal: never counted twice
    wb.setInput(report, 0, 0, '=SUBTOTAL(9,Data!A1:A10)');
    wb.setInput(report, 1, 0, '=SUBTOTAL(109,Data!A1:A10)');
    expect(wb.getValue(data, 3, 0)).toBe(3);
    expect(wb.getValue(report, 0, 0)).toBe(9); // nine plain 1s, the nested total left out
    wb.setHidden(data, 'row', [0, 1], true);
    expect(wb.getValue(report, 0, 0)).toBe(9); // 9 counts rows hidden by hand
    expect(wb.getValue(report, 1, 0)).toBe(7); // 109 does not
  });

  it('still answers #REF! for a sheet that is not there, and finds a sheet renamed since', () => {
    const { wb, report } = book(5);
    wb.setInput(report, 0, 0, '=SUBTOTAL(9,Missing!A1:A5)');
    expect(wb.getValue(report, 0, 0)).toEqual({ error: '#REF!' });

    const { wb: wb2, data, report: report2 } = book(5);
    wb2.setInput(report2, 0, 0, '=SUBTOTAL(9,Numbers!A1:A5)');
    expect(wb2.getValue(report2, 0, 0)).toEqual({ error: '#REF!' });
    wb2.renameSheet(data, 'Numbers');
    expect(wb2.getValue(report2, 0, 0)).toBe(5);
  });
});
