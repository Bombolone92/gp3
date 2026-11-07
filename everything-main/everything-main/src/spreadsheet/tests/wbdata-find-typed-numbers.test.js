import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { findAll, cellMatches, replaceCells } from '../src/core/search.js';

/** A1 holds 1500 shown as $1,500.00, A2 0.5 shown as 50%, A3 a date shown by a custom code, A4 the text "1500". */
function sheet() {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '1500');
  wb.applyStyle(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, { fmt: 'currency', dec: 2 });
  wb.setInput(id, 1, 0, '50%');
  wb.setInput(id, 2, 0, '2024-01-15');
  wb.applyStyle(id, { r1: 2, c1: 0, r2: 2, c2: 0 }, { fmt: 'custom', code: 'dd/mm/yyyy' });
  wb.setInput(id, 3, 0, "'1500");
  expect([0, 1, 2].map((r) => wb.getDisplay(id, r, 0))).toEqual(['$1,500.00', '50%', '15/01/2024']);
  return { wb, id };
}

it('finds a number by the value typed into it as well as by the text its format shows', () => {
  const { wb, id } = sheet();
  expect(findAll(wb, id, '1500').map((m) => m.r)).toEqual([0, 3]);
  expect(findAll(wb, id, '$1,500').map((m) => m.r)).toEqual([0]);
  expect(findAll(wb, id, '1500', { wholeCell: true }).map((m) => m.r)).toEqual([0, 3]);
  expect(findAll(wb, id, '50%').map((m) => m.r)).toEqual([1]);
  expect(findAll(wb, id, '2024-01-15').map((m) => m.r)).toEqual([2]);
  expect(findAll(wb, id, '15/01/2024').map((m) => m.r)).toEqual([2]);
  expect(findAll(wb, id, '99')).toEqual([]);
  // Find and Replace agree on what a cell holds: what Replace can change, Find can see.
  expect(replaceCells(wb, id, [{ r: 0, c: 0 }], '1500', '1600')).toBe(1);
  expect(wb.getValue(id, 0, 0)).toBe(1600);
  expect(wb.getDisplay(id, 0, 0)).toBe('$1,600.00');
});

it('still leaves formulas to the formula option and text to its display', () => {
  const { wb, id } = sheet();
  wb.setInput(id, 4, 0, '=A1*2');
  expect(cellMatches(wb.getCell(id, 4, 0), wb.getDisplay(id, 4, 0), 'A1')).toBe(true);
  expect(cellMatches(wb.getCell(id, 4, 0), wb.getDisplay(id, 4, 0), 'A1', { formulas: false })).toBe(false);
  expect(cellMatches(wb.getCell(id, 4, 0), wb.getDisplay(id, 4, 0), '3,000')).toBe(true);
  expect(cellMatches(wb.getCell(id, 3, 0), '1500', "'1500")).toBe(false);
});
