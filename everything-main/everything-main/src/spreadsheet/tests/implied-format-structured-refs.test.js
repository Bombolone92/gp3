import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';
import { impliedFormulaStyle } from '../src/core/implied-format.js';

// The format a formula implied stopped at a structured reference or a defined name, so =B2*C2 beside a table
// took the currency of column B while the calculated column's own =[@Price]*[@Qty] and =SUM(T[Price]) and
// =SUM(Prices) showed bare numbers, in the one place structured references are the normal spelling.
function priced() {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, [
    { r: 0, c: 0, cell: { v: 'Item' } }, { r: 0, c: 1, cell: { v: 'Price' } }, { r: 0, c: 2, cell: { v: 'Qty' } }, { r: 0, c: 3, cell: { v: 'Total' } },
    { r: 1, c: 0, cell: { v: 'a' } }, { r: 1, c: 1, cell: { v: 10, s: { fmt: 'currency' } } }, { r: 1, c: 2, cell: { v: 2 } },
    { r: 2, c: 0, cell: { v: 'b' } }, { r: 2, c: 1, cell: { v: 20, s: { fmt: 'currency' } } }, { r: 2, c: 2, cell: { v: 3 } },
  ]);
  wb.addTable(id, parseRange('A1:D3'), { name: 'T' });
  wb.defineName('Prices', `${wb.sheet(id).name}!$B$2:$B$3`);
  return { wb, id };
}

it.each([
  ['=[@Price]*[@Qty]', '$20.00'],
  ['=T[@Price]*T[@Qty]', '$20.00'],
  ['=B2*C2', '$20.00'],
])('gives a calculated column typing %s the currency of the column it reads', (formula, shown) => {
  const { wb, id } = priced();
  wb.setInput(id, 1, 3, formula);
  expect(wb.getCell(id, 1, 3).s).toMatchObject({ fmt: 'currency' });
  expect(wb.getDisplay(id, 1, 3)).toBe(shown);
});

it.each([
  ['=SUM(T[Price])', '$30.00'],
  ['=SUM(Prices)', '$30.00'],
  ['=SUM(B2:B3)', '$30.00'],
  ['=Prices', '$10.00'],
])('carries the currency of %s into a formula outside the table', (formula, shown) => {
  const { wb, id } = priced();
  wb.setInput(id, 5, 0, formula);
  expect(wb.getDisplay(id, 5, 0)).toBe(shown);
});

it('carries nothing where the plain reference carries nothing, and through a Ctrl+Enter fill', () => {
  const { wb, id } = priced();
  // A count is a count, whichever way the column is spelled.
  wb.setInput(id, 5, 0, '=COUNT(T[Price])');
  expect(wb.getCell(id, 5, 0).s).toBeUndefined();
  // A structured reference that names nothing from where it sits suggests nothing either.
  wb.setInput(id, 6, 6, '=[@Price]');
  expect(wb.getCell(id, 6, 6).s).toBeUndefined();
  wb.fillInput(id, parseRange('D2:D3'), '=T[@Price]*2', { r: 1, c: 3 });
  expect(wb.getCell(id, 1, 3).s).toMatchObject({ fmt: 'currency' });
  expect(wb.getCell(id, 2, 3).s).toMatchObject({ fmt: 'currency' });
});

it('leaves a name alone when the caller offers no way to resolve one', () => {
  expect(impliedFormulaStyle('SUM(Prices)', () => ({ fmt: 'currency' }))).toBeNull();
  expect(impliedFormulaStyle('SUM(Prices)', () => ({ fmt: 'currency' }), () => ({ r1: 0, c1: 0 }))).toEqual({ fmt: 'currency' });
  // A name a function answers to is still that function.
  expect(impliedFormulaStyle('TODAY()', () => null, () => ({ r1: 0, c1: 0 }))).toEqual({ fmt: 'date' });
});
