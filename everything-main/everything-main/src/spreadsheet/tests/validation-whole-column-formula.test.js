import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';

// A custom validation formula that reads a whole column (=COUNTIF(A:A,A1)=1, the classic
// no-duplicates rule) never saw the value being typed: the whole-column read stops at the
// used range, so the row being typed into lay past the array and was never patched with the
// pending entry, while the single-cell criterion still was. The rule then accepted a duplicate
// (counted once, in the existing rows) and refused a fresh value (counted zero times). The
// pending entry is now written into the read whether or not the row was read.
function book() {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, [['x'], ['y']].flatMap((row, r) => row.map((v, c) => ({ r, c, cell: { v } }))));
  return { wb, id };
}

it('sees the pending entry through a whole-column reference, so a duplicate is refused and a fresh value accepted', () => {
  const { wb, id } = book();
  wb.addValidation(id, { type: 'formula', source: '=COUNTIF(A:A,A1)=1', range: parseRange('A1:A50'), strict: true });
  expect(wb.validateInput(id, 2, 0, 'x').ok).toBe(false);
  expect(wb.validateInput(id, 2, 0, 'z').ok).toBe(true);
  // Far past the used range as well, and for a cell already read (a retyped existing row).
  expect(wb.validateInput(id, 40, 0, 'y').ok).toBe(false);
  expect(wb.validateInput(id, 40, 0, 'w').ok).toBe(true);
  expect(wb.validateInput(id, 1, 0, 'x').ok).toBe(false);
  expect(wb.validateInput(id, 1, 0, 'y').ok).toBe(true);
  // The bounded spelling keeps working.
  wb.addValidation(id, { type: 'formula', source: '=COUNTIF($A$1:$A$50,A1)=1', range: parseRange('A1:A50'), strict: true });
  expect([wb.validateInput(id, 2, 0, 'x').ok, wb.validateInput(id, 2, 0, 'z').ok]).toEqual([false, true]);
});

it('pads a whole-row read out to the column being typed into', () => {
  const { wb, id } = book();
  wb.addValidation(id, { type: 'formula', source: '=COUNTIF(1:1,A1)=1', range: parseRange('A1:Z1'), strict: true });
  expect(wb.validateInput(id, 0, 5, 'x').ok).toBe(false);
  expect(wb.validateInput(id, 0, 5, 'z').ok).toBe(true);
});

it('patches a copy of the read, leaving the shared array the formulas use untouched', () => {
  const { wb, id } = book();
  wb.setInput(id, 0, 2, '=COUNTIF(A:A,"z")');
  wb.setInput(id, 1, 2, '=COUNTA(A:A)');
  wb.addValidation(id, { type: 'formula', source: '=COUNTIF(A:A,A1)=1', range: parseRange('A1:A50'), strict: true });
  expect(wb.validateInput(id, 2, 0, 'z').ok).toBe(true);
  expect(wb.validateInput(id, 30, 0, 'z').ok).toBe(true);
  expect([wb.getValue(id, 0, 2), wb.getValue(id, 1, 2)]).toEqual([0, 2]);
});
