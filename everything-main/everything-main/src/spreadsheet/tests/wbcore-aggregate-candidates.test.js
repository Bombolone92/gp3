import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

// An aggregate's answer is one value however its argument is shaped, but SUMPRODUCT((A>k)*B)
// and SUM(A*2) were classed as spill candidates and settled sheet-wide on every change.
it('does not treat an aggregate over an array expression as a spill candidate', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  for (let r = 0; r < 10; r++) { wb.setInput(id, r, 0, String(r + 1)); wb.setInput(id, r, 1, String(r * 2)); }
  wb.setInput(id, 0, 3, '=SUMPRODUCT((A1:A10>5)*B1:B10)');
  wb.setInput(id, 1, 3, '=SUM(A1:A10*2)');
  wb.setInput(id, 2, 3, '=SUM(-A1:A10)');
  wb.setInput(id, 0, 5, '=A1:A3*2'); // an array expression on its own still spills
  expect(wb.getValue(id, 0, 3)).toBe(70);
  expect(wb.getValue(id, 1, 3)).toBe(110);
  expect(wb.getValue(id, 2, 3)).toBe(-55);
  expect(wb.getValue(id, 0, 5)).toBe(2);
  expect(wb.getValue(id, 2, 5)).toBe(6);
  const candidate = (f) => wb._isArrayCandidate(wb._ast(f));
  expect(candidate('SUMPRODUCT((A1:A10>5)*B1:B10)')).toBe(false);
  expect(candidate('SUM(A1:A10*2)')).toBe(false);
  expect(candidate('SUM(-A1:A10)')).toBe(false);
  expect(candidate('COUNT(A1:A10%)')).toBe(false);
  expect(candidate('A1:A3*2')).toBe(true);
  expect(candidate('-A1:A3')).toBe(true);
  expect(candidate('IF(A1>0,A1:A3*2,0)')).toBe(true); // IF may hand its array argument back
  expect(candidate('SUM(A1:A3)*SEQUENCE(3)')).toBe(true);
  expect(wb.spillEntries(id).map(({ r, c }) => `${r},${c}`)).toEqual(['1,5', '2,5']);
});
