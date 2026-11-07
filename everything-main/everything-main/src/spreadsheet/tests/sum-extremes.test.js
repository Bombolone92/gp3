import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { columnStats } from '../src/core/stats.js';
import { summarize, summarizeAll } from '../src/ui/statusbar.js';

const overflow = { error: '#NUM!' };

it.each([
  [[1e308, 1e308, -1e308], 1e308, overflow],
  [[-1e308, -1e308, 1e308], -1e308, overflow],
  [[Number.MAX_VALUE, Number.MAX_VALUE, -Number.MAX_VALUE, -Number.MAX_VALUE, 1e-100], 1e-100, overflow],
  // Input order overflows before later cancellation, even with a tiny remainder.
  [[Number.MAX_VALUE, Number.MAX_VALUE, -Number.MAX_VALUE, -Number.MAX_VALUE, Number.MIN_VALUE], Number.MIN_VALUE, overflow],
  [[Number.MAX_VALUE, Number.MAX_VALUE, -Number.MAX_VALUE, -Number.MAX_VALUE], 0, overflow],
  [[0.1, 0.2], 0.1 + 0.2],
])('retains native worksheet overflow and independent summary recovery for %j', (values, expected, worksheetExpected = expected) => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, values.flatMap((v, r) => [{ r, c: 0, cell: { v } }, { r, c: 1, cell: { v: 'yes' } }, { r, c: 2, cell: { v: 1 } }]));
  const ref = `A1:A${values.length}`, criteria = `B1:B${values.length}`, ones = `C1:C${values.length}`;
  const formulas = [[`SUM(${ref})`, worksheetExpected], [`SUMIF(${criteria},"yes",${ref})`, worksheetExpected], [`SUMIFS(${ref},${criteria},"yes")`, worksheetExpected],
    [`SUMPRODUCT(${ref},${ones})`, worksheetExpected], [`SUBTOTAL(109,${ref})`, worksheetExpected], [`AGGREGATE(9,0,${ref})`, worksheetExpected], [`QUERY(${ref},"select sum(A)",0)`, expected]];
  for (const [r, [f, answer]] of formulas.entries()) {
    wb.setInput(id, r, 4, `=${f}`);
    expect(wb.getValue(id, r, 4), f).toEqual(answer);
  }
  const range = { r1: 0, c1: 0, r2: values.length - 1, c2: 0 };
  expect(columnStats(wb, id, 0, range).sum).toBe(expected);
  expect(summarize(wb, id, range).sum).toBe(expected);
  const separate = values.map((_, r) => ({ r1: r, c1: 0, r2: r, c2: 0 }));
  expect(summarizeAll(wb, id, separate).sum).toBe(expected);
});

it('retains intermediate overflow when summing selected database rows', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, [['Value', 'Use'], [1e308, 'yes'], [1e308, 'yes'], [-1e308, 'yes'], [7, 'no']].flatMap((row, r) => row.map((v, c) => ({ r, c, cell: { v } }))));
  wb.setInput(id, 0, 3, 'Use');
  wb.setInput(id, 1, 3, 'yes');
  wb.setInput(id, 0, 5, '=DSUM(A1:B5,1,D1:D2)');
  expect(wb.getValue(id, 0, 5)).toEqual(overflow);
});

it('retains overflow reporting when the final sum is too large', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '=SUM(1e307*10,1e307*10)');
  expect(wb.getDisplay(id, 0, 0)).toBe('#NUM!');
});
