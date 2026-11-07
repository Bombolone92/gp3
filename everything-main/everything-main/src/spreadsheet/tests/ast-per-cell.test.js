import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

it('parses each cell\'s formula once even when the sheet holds more distinct formulas than the text cache', () => {
  const rows = 12000;
  const wb = new Workbook({ sheets: [{ name: 'S', rows: rows + 1, cols: 2, cells: Object.fromEntries(
    Array.from({ length: rows }, (_, r) => [[`${r},0`, { v: r }], [`${r},1`, { f: `A${r + 1}*2` }]]).flat(),
  ) }] });
  const id = wb.activeSheetId;
  let parses = 0;
  const original = wb._ast;
  wb._ast = function (f) { parses++; return original.call(this, f); };
  for (let r = 0; r < rows; r++) wb.getValue(id, r, 1);
  expect(parses).toBe(rows);
  wb.setInput(id, 0, 0, '100');
  for (let r = 0; r < rows; r++) wb.getValue(id, r, 1);
  expect(parses).toBe(rows); // nothing reparsed after the edit
  expect(wb.getValue(id, 0, 1)).toBe(200);
  // A changed formula is parsed afresh, and structural renumbering keeps the cells' ASTs current.
  wb.setInput(id, 5, 1, '=A6*3');
  expect(wb.getValue(id, 5, 1)).toBe(15);
  wb.insertRows(id, 0, 1);
  expect(wb.getValue(id, 6, 1)).toBe(15);
  expect(wb.getCell(id, 6, 1).f).toBe('A7*3');
});
