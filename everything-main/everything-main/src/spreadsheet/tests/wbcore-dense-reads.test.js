import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

// A read covering most of a filled sheet asked for every cell by its "r,c" key, about a
// microsecond each: SUM(A1:AX20000) over a million filled cells took a second, on every edit.
it('reads a range covering most of a filled sheet from its cells directly', () => {
  const rows = 2000;
  const cols = 10;
  const cells = {};
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) cells[`${r},${c}`] = { v: r + c };
  cells[`${rows},0`] = { f: `SUM(A1:J${rows})` };
  cells[`${rows},1`] = { f: `COUNT(A1:J${rows})` };
  cells[`${rows},2`] = { f: `SUM(A1:A100)` }; // a small range is still read cell by cell
  cells[`${rows - 1},9`] = { f: 'A1+1' }; // a formula inside the block is calculated
  const wb = new Workbook({ sheets: [{ name: 'S', rows: rows + 5, cols: cols + 1, cells }] });
  const id = wb.activeSheetId;
  let computes = 0;
  const compute = wb._compute.bind(wb);
  wb._compute = (...args) => { computes++; return compute(...args); };
  const expected = rows * cols * (rows - 1) / 2 + rows * (cols - 1) * cols / 2 - (rows - 1 + 9) + 1;
  expect(wb.getValue(id, rows, 0)).toBe(expected);
  expect(computes).toBeLessThan(20); // the formula, the one formula cell inside, not twenty thousand values
  expect(wb.getValue(id, rows, 1)).toBe(rows * cols);
  expect(wb.getValue(id, rows, 2)).toBe((99 * 100) / 2);
  wb.setInput(id, 0, 0, '1000'); // an edit is seen, in the value and in the formula that reads it
  expect(wb.getValue(id, rows - 1, 9)).toBe(1001);
  expect(wb.getValue(id, rows, 0)).toBe(expected + 2000);
});
