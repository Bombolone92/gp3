import { expect, it } from 'vitest';
import { Workbook, MAX_ROWS } from '../src/core/workbook.js';

it.each(['first', 'last', 'sheet'])('refuses the entire linked paste when %s protection blocks a destination', (protection) => {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '10'); wb.setInput(id, 1, 0, '20');
  wb.setInput(id, 0, 2, '5'); wb.setInput(id, 1, 2, '7');
  if (protection === 'sheet') wb.setSheetProtected(id, true);
  else {
    const r = protection === 'first' ? 0 : 1;
    wb.protectRange(id, { r1: r, c1: 0, r2: r, c2: 0 });
  }
  wb.clearHistory();
  const before = wb.toJSON();
  const refused = [];
  wb.addEventListener('change', (event) => { if (event.detail.type === 'protected') refused.push(event.detail); });
  expect(wb.pasteLinks(id, 0, 0, id, [0, 1], [2])).toBe(0);
  expect(wb.toJSON()).toEqual(before);
  expect(wb.canUndo()).toBe(false);
  expect(refused).toHaveLength(1);
});

it('reaches past the sheet\'s edge as pasted cells do, growing the sheet, and checks protection as far as it reaches', () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  const src = wb.addSheet("Input's values").id;
  wb.setInput(src, 0, 0, '5'); wb.setInput(src, 2, 0, '7');
  const sheet = wb.sheet(id), r = sheet.rows - 1, c = sheet.cols - 1;
  wb.applyStyle(id, { r1: r, c1: c, r2: r, c2: c }, { bold: true });
  wb.clearHistory();
  expect(wb.pasteLinks(id, r, c, src, [0, 2], [0])).toBe(2);
  expect(wb.getValue(id, r, c)).toBe(5);
  expect(wb.getCell(id, r, c)).toMatchObject({ f: "'Input''s values'!A1", s: { bold: true } });
  expect(wb.getValue(id, r + 1, c)).toBe(7);
  expect(wb.sheet(id).rows).toBeGreaterThan(r + 1);
  expect(wb.undoLabels()).toHaveLength(1);
  wb.undo(); expect(wb.getValue(id, r, c)).toBeNull(); expect(wb.getValue(id, r + 1, c)).toBeNull();
  wb.redo(); expect(wb.getValue(id, r + 1, c)).toBe(7);
  // A protected cell past the edge refuses the paste before any link is written, as one inside does.
  wb.protectRange(id, { r1: r + 3, c1: 0, r2: r + 3, c2: 0 });
  wb.clearHistory();
  const before = wb.toJSON();
  expect(wb.pasteLinks(id, r + 2, 0, src, [0, 2], [0])).toBe(0);
  expect(wb.toJSON()).toEqual(before);
  expect(wb.canUndo()).toBe(false);
  // The grid's last row is as far as links go, as it is for pasted cells.
  expect(wb.pasteLinks(id, MAX_ROWS - 1, 0, src, [0, 2], [0])).toBe(1);
  expect(wb.getCell(id, MAX_ROWS - 1, 0).f).toBe("'Input''s values'!A1");
  expect(wb.getCell(id, MAX_ROWS, 0)).toBeUndefined();
});

it('retains table expansion and calculated columns for an allowed linked paste', () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setCells(id, [['Amount', 'Double'], [3, null]].flatMap((row, r) => row.map((v, c) => ({ r, c, cell: { v } }))));
  wb.setInput(id, 0, 3, '5'); wb.setInput(id, 1, 3, '7');
  const table = wb.addTable(id, { r1: 0, c1: 0, r2: 1, c2: 1 }, { name: 'Sales' });
  wb.setInput(id, 1, 1, '=[@Amount]*2');
  wb.clearHistory();
  expect(wb.pasteLinks(id, 2, 0, id, [0, 1], [3])).toBe(2);
  expect(wb.tableById(id, table).range.r2).toBe(3);
  expect(wb.getValue(id, 2, 1)).toBe(10);
  expect(wb.getValue(id, 3, 1)).toBe(14);
  expect(wb.undoLabels()).toHaveLength(1);
  wb.undo(); expect(wb.tableById(id, table).range.r2).toBe(1);
  wb.redo(); expect(wb.getValue(id, 3, 1)).toBe(14);
});
