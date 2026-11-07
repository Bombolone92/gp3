import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

it.each(['range', 'sheet'])('keeps protected %s formulas pointing at moved cells with undo support', (protection) => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '7');
  wb.setInput(id, 0, 2, '=$A$1*2');
  wb.protectRange(id, { r1: 0, c1: 2, r2: 0, c2: 2 });
  const other = wb.addSheet('Summary').id;
  wb.setInput(other, 0, 0, '=Sheet1!A1*3');
  if (protection === 'range') wb.protectRange(other, { r1: 0, c1: 0, r2: 0, c2: 0 });
  else wb.setSheetProtected(other, true);
  wb.clearHistory();
  const before = wb.toJSON();
  expect(wb.moveRange(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, 3, 1)).toEqual({ r1: 3, c1: 1, r2: 3, c2: 1 });
  expect(wb.getCell(id, 0, 2).f).toBe('$B$4*2');
  expect(wb.getValue(id, 0, 2)).toBe(14);
  expect(wb.getCell(other, 0, 0).f).toBe('Sheet1!B4*3');
  expect(wb.getValue(other, 0, 0)).toBe(21);
  expect(wb.undoLabels()).toEqual(['Move cells']);
  const after = wb.toJSON();
  wb.setInput(other, 0, 0, '99');
  expect(wb.toJSON()).toEqual(after);
  wb.undo();
  expect(wb.toJSON()).toEqual(before);
  wb.redo();
  expect(wb.toJSON()).toEqual(after);
});
