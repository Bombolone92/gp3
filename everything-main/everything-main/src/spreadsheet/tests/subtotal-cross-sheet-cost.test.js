import { afterEach, describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseCellRef, parseRange } from '../src/core/cell.js';

// SUBTOTAL, and AGGREGATE with options 0-3 or an odd option, ask the context for a cell's
// formula and for its row's hidden state. Both take the sheet by name and looked it up per
// cell, so a totals row over another sheet's 20,000-row column ran a linear scan of the book's
// sheet names 40,000 times per formula on every recalculation. The range's sheet is now
// resolved once, before the walk.
const original = Workbook.prototype.sheetByName;
afterEach(() => { Workbook.prototype.sheetByName = original; });

function countLookups(run) {
  let calls = 0;
  Workbook.prototype.sheetByName = function (...args) { calls++; return original.apply(this, args); };
  try { run(); } finally { Workbook.prototype.sheetByName = original; }
  return calls;
}

function bookWithDataSheet(rows) {
  const wb = new Workbook();
  const main = wb.sheets[0].id;
  wb.addSheet('Data');
  const data = wb.sheets[wb.sheets.length - 1].id;
  for (let r = 0; r < rows; r++) wb.setInput(data, r, 1, String((r * 7) % 101));
  return { wb, main, data };
}

describe('the cost of a SUBTOTAL over another sheet', () => {
  it('resolves the sheet once for the range, not once for every cell', () => {
    const ROWS = 4000;
    const { wb, main } = bookWithDataSheet(ROWS);
    for (const [row, formula] of [
      [0, 'SUM(Data!B1:B4000)'],
      [1, 'SUBTOTAL(9,Data!B1:B4000)'],
      [2, 'SUBTOTAL(109,Data!B1:B4000)'],
      [3, 'AGGREGATE(9,1,Data!B1:B4000)'],
      [4, 'AGGREGATE(9,5,Data!B1:B4000)'],
    ]) wb.setInput(main, row, 5, `=${formula}`);

    const total = wb.getValue(main, 0, 5);
    const counts = [];
    for (let row = 0; row < 5; row++) {
      wb.setInput(main, 10, 0, String(row)); // a fresh edit, so every formula is recalculated
      counts.push(countLookups(() => { expect(wb.getValue(main, row, 5)).toBe(total); }));
    }
    // Every one of these used to scan the sheet list once or twice per row.
    for (const calls of counts) expect(calls).toBeLessThan(ROWS / 10);
  });

  it('still leaves out nested totals and hidden rows on the other sheet', () => {
    const wb = new Workbook();
    const main = wb.sheets[0].id;
    wb.addSheet('Data');
    const data = wb.sheets[wb.sheets.length - 1].id;
    for (const [a1, text] of Object.entries({
      A1: '1', A2: '2', A3: '3', A4: '4', A5: '=SUBTOTAL(9,A1:A4)', B1: 'keep', B2: 'drop', B3: 'keep', B4: 'keep',
    })) { const { r, c } = parseCellRef(a1); wb.setInput(data, r, c, text); }

    wb.setInput(main, 0, 0, '=SUBTOTAL(9,Data!A1:A5)');
    wb.setInput(main, 1, 0, '=SUBTOTAL(109,Data!A1:A5)');
    wb.setInput(main, 2, 0, '=AGGREGATE(9,1,Data!A1:A5)');
    wb.setInput(main, 3, 0, '=AGGREGATE(9,4,Data!A1:A5)');
    expect(wb.getValue(main, 0, 0)).toBe(10); // the nested SUBTOTAL cell is left out
    expect(wb.getValue(main, 1, 0)).toBe(10);
    expect(wb.getValue(main, 2, 0)).toBe(10);
    expect(wb.getValue(main, 3, 0)).toBe(20); // option 4 counts it like any other cell

    wb.setFilterRange(data, parseRange('B1:B4'));
    wb.setFilterCriteria(data, 1, { values: ['keep'] });
    expect([...wb.sheet(data).filterHidden]).toEqual([1]);
    expect(wb.getValue(main, 0, 0)).toBe(8);
    expect(wb.getValue(main, 2, 0)).toBe(8);
    expect(wb.getValue(main, 3, 0)).toBe(18); // an even option keeps the hidden row and the nested total, now 8

    wb.setHidden(data, 'row', [2], true);
    expect(wb.getValue(main, 0, 0)).toBe(8); // code 9 keeps rows hidden by hand
    expect(wb.getValue(main, 1, 0)).toBe(5);
  });
});
