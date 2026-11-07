import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

const range = { r1: 0, c1: 0, r2: 0, c2: 1 };

it.each([
  ['column width', (wb, id) => wb.setColWidth(id, 0, 150)],
  ['row height', (wb, id) => wb.setRowHeight(id, 0, 50)],
  ['protected range', (wb, id) => wb.protectRange(id, range, 'Keep locked')],
  ['sheet color', (wb, id) => wb.setSheetColor(id, '#ff0000')],
  ['frozen panes', (wb, id) => wb.setFrozen(id, 2, 1)],
  ['note', (wb, id) => wb.setNote(id, 0, 0, 'Remember this')],
  ['merged cells', (wb, id) => wb.mergeCells(id, range)],
  ['hidden rows', (wb, id) => wb.setHidden(id, 'row', [0, 1], true)],
  ['hidden columns', (wb, id) => wb.setHidden(id, 'col', [0, 1], true)],
])('undoes and redoes %s after undoing a structural edit', (_label, edit) => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  const before = wb.toJSON();
  edit(wb, id);
  const edited = wb.toJSON();
  expect(edited).not.toEqual(before);
  wb.insertRows(id, 5, 1);
  const inserted = wb.toJSON();
  wb.undo();
  expect(wb.toJSON()).toEqual(edited);
  wb.undo();
  expect(wb.toJSON()).toEqual(before);
  wb.redo();
  expect(wb.toJSON()).toEqual(edited);
  wb.redo();
  expect(wb.toJSON()).toEqual(inserted);
});
