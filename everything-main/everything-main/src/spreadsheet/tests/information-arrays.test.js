import { expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { FUNCTIONS } from '../src/core/formula/functions.js';

it('keeps scalar information formulas lazy during spill discovery', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, Array.from({ length: 1000 }, (_, r) => ({ r, c: 0, cell: { f: `ISNUMBER(${r})` } })));
  const inspect = vi.spyOn(FUNCTIONS.ISNUMBER, 'fn');
  try {
    expect(wb.getValue(id, 0, 0)).toBe(true);
    expect(wb.getValue(id, 0, 1)).toBeNull();
    expect(inspect).toHaveBeenCalledTimes(1);
  } finally { inspect.mockRestore(); }
});

it.each([
  ['ISNUMBER', [[true, false, false], [false, false, false]]],
  ['ISTEXT', [[false, true, false], [false, false, false]]],
  ['ISNONTEXT', [[true, false, true], [true, true, true]]],
  ['ISLOGICAL', [[false, false, true], [false, false, false]]],
  ['ISBLANK', [[false, false, false], [true, false, false]]],
  ['ISERROR', [[false, false, false], [false, true, true]]],
  ['ISERR', [[false, false, false], [false, false, true]]],
  ['ISNA', [[false, false, false], [false, true, false]]],
])('%s tests every range cell and preserves the shape of its result', (fn, expected) => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, [[1, '1', true], [null, { error: '#N/A' }, { error: '#DIV/0!' }]]
    .flatMap((row, r) => row.map((v, c) => ({ r, c, cell: { v } }))));
  wb.setInput(id, 0, 4, `=${fn}(A1:C2)`);
  expect(wb.getValue(id, 1, 6)).toBe(expected[1][2]); // Read the spill child first.
  expect([0, 1].map((r) => [4, 5, 6].map((c) => wb.getValue(id, r, c)))).toEqual(expected);
});

it('uses information arrays in counts, filters, and conditional formulas', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '=SUM(--ISNUMBER({1,"2",3,TRUE}))');
  expect(wb.getValue(id, 0, 0)).toBe(2);
  wb.setInput(id, 0, 0, '=FILTER({1;"2";3},ISNUMBER({1;"2";3}))');
  expect([0, 1].map((r) => wb.getValue(id, r, 0))).toEqual([1, 3]);
  wb.setInput(id, 0, 0, '=IF(ISERROR({1,#N/A;#DIV/0!,4}),"Error","OK")');
  expect([0, 1].map((r) => [0, 1].map((c) => wb.getValue(id, r, c)))).toEqual([['OK', 'Error'], ['Error', 'OK']]);
});

it('updates array predicates after source edits, undo, and saving', async () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '1');
  wb.setInput(id, 1, 0, 'Text');
  wb.setInput(id, 0, 2, '=ISNUMBER(A1:A2)');
  expect([0, 1].map((r) => wb.getValue(id, r, 2))).toEqual([true, false]);
  wb.setInput(id, 1, 0, '2');
  expect(wb.getValue(id, 1, 2)).toBe(true);
  wb.undo();
  expect(wb.getValue(id, 1, 2)).toBe(false);
  const back = await workbookFromFile(await workbookToXlsx(wb), 'information.xlsx');
  expect([0, 1].map((r) => back.getValue(back.activeSheetId, r, 2))).toEqual([true, false]);
});
