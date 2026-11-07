import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';

it.each(['A1', 'B1', 'C1'])('refuses the entire merge when %s is protected, including blank cells', (address) => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, 'Heading');
  wb.setInput(id, 0, 1, 'Keep');
  wb.protectRange(id, parseRange(address), 'Keep this cell');
  const before = wb.toJSON();
  const history = wb.undoLabels();
  const events = [];
  wb.addEventListener('change', (e) => events.push(e.detail));
  wb.mergeCells(id, parseRange('A1:C1'));
  expect(wb.toJSON()).toEqual(before);
  expect(wb.undoLabels()).toEqual(history);
  expect(events).toContainEqual(expect.objectContaining({ type: 'protected', description: 'Keep this cell' }));
});

it.each(['merge', 'unmerge'])('refuses %s when it would alter an existing merge containing a protected cell outside the selection', (action) => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.mergeCells(id, parseRange('B1:C1'));
  wb.protectRange(id, parseRange('C1'));
  const before = wb.toJSON();
  const history = wb.undoLabels();
  if (action === 'merge') wb.mergeCells(id, parseRange('A1:B1'));
  else wb.unmergeCells(id, parseRange('B1'));
  expect(wb.toJSON()).toEqual(before);
  expect(wb.undoLabels()).toEqual(history);
});

it('still merges and unmerges unprotected cells with undo and redo', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, 'Heading');
  wb.setInput(id, 0, 1, 'Other');
  wb.protectRange(id, parseRange('C1'));
  const before = wb.toJSON();
  wb.mergeCells(id, parseRange('A1:B1'));
  const merged = wb.toJSON();
  expect(wb.getValue(id, 0, 1)).toBeNull();
  expect(wb.sheet(id).merges).toEqual([parseRange('A1:B1')]);
  wb.undo();
  expect(wb.toJSON()).toEqual(before);
  wb.redo();
  expect(wb.toJSON()).toEqual(merged);
  wb.unmergeCells(id, parseRange('B1'));
  expect(wb.sheet(id).merges).toEqual([]);
  wb.undo();
  expect(wb.toJSON()).toEqual(merged);
});
