import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { calc } from './helpers/calc.js';

// INDEX with a row or column number of 0 sized its reference to the values read, which for a whole
// column is a window past the used area that grows as formulas are written further down the sheet, so
// ROWS(INDEX(A:A,0,1)) was an arbitrary number. The reference keeps its own extent on an axis left
// at 0: 1048576 rows for a whole column, 5000 for A1:B5000, whatever the sheet holds.
const DATA = { A1: '1', A2: '2', A3: '3', A4: '4', A5: '5', B1: '10', B2: '20' };

it('keeps a whole column or row whole', () => {
  expect(calc('ROWS(INDEX(A:A,0,1))', DATA)).toBe(1048576);
  expect(calc('ROWS(INDEX(A:C,0,2))', DATA)).toBe(1048576);
  expect(calc('COLUMNS(INDEX(A:C,0,2))', DATA)).toBe(1);
  expect(calc('COLUMNS(INDEX(1:1,1,0))', DATA)).toBe(16384);
  expect(calc('ROWS(INDEX(1:3,0,2))', DATA)).toBe(3);
  expect(calc('ROWS(INDEX(A:C,2,0))', DATA)).toBe(1);
  expect(calc('COLUMNS(INDEX(A:C,2,0))', DATA)).toBe(3);
  expect(calc('ROWS(INDEX(A:A,0,0))', DATA)).toBe(1048576);
});

it('keeps a bounded reference\'s extent past the values read', () => {
  expect(calc('ROWS(INDEX(A1:B5000,0,1))', DATA)).toBe(5000);
  expect(calc('COLUMNS(INDEX(A1:B5000,0,1))', DATA)).toBe(1);
  expect(calc('ROWS(INDEX(A1:B5000,3,0))', DATA)).toBe(1);
  expect(calc('COLUMNS(INDEX(A1:B5000,3,0))', DATA)).toBe(2);
  expect(calc('ROWS(INDEX(A1:B5000,0,0))', DATA)).toBe(5000);
  expect(calc('ROWS(INDEX(A1:B5000,,2))', DATA)).toBe(5000);
});

it('still reads the values and the address of the selection', () => {
  expect(calc('SUM(INDEX(A:A,0,1))', DATA)).toBe(15);
  expect(calc('COUNTA(INDEX(A:A,0,1))', DATA)).toBe(5);
  expect(calc('SUM(INDEX(A1:B5000,0,1))', DATA)).toBe(15);
  expect(calc('SUM(INDEX(A1:B5000,2,0))', DATA)).toBe(22);
  expect(calc('SUMPRODUCT(INDEX(A1:B5000,0,1)*2)', DATA)).toBe(30);
  expect(calc('ROW(INDEX(A1:B5000,3,0))', DATA)).toBe(3);
  expect(calc('COLUMN(INDEX(A1:B5000,0,2))', DATA)).toBe(2);
  expect(calc('COLUMN(INDEX(A:C,0,2))', DATA)).toBe(2);
  expect(calc('INDEX(INDEX(A:A,0,1),4)', DATA)).toBe(4);
  expect(calc('SUM(INDEX({1,10;2,20},0,2))', DATA)).toBe(30); // an array has no address to keep
});

it('does not change as unrelated cells are written further down', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  for (let r = 0; r < 5; r++) wb.setInput(id, r, 0, String(r + 1));
  wb.setInput(id, 0, 2, '=ROWS(INDEX(A:A,0,1))');
  wb.setInput(id, 0, 3, '=ROWS(INDEX(A1:A3000,0,1))');
  expect(wb.getValue(id, 0, 2)).toBe(1048576);
  expect(wb.getValue(id, 0, 3)).toBe(3000);
  wb.setInput(id, 2500, 4, 'far away');
  wb.setInput(id, 2600, 0, '=SUM(A1:A5)');
  expect(wb.getValue(id, 0, 2)).toBe(1048576);
  expect(wb.getValue(id, 0, 3)).toBe(3000);
});
