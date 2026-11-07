import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

function book() {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, [['Item', 'Qty'], ['a', 1]].flatMap((row, r) => row.map((v, c) => ({ r, c, cell: { v } }))));
  const tid = wb.addTable(id, { r1: 0, c1: 0, r2: 1, c2: 1 }, { name: 'T' });
  wb.setInput(id, 4, 4, '=SUM(T[Qty])');
  wb.clearHistory();
  const columns = () => wb.tableColumns(id, wb.tableById(id, tid));
  return { wb, id, columns };
}

it('declines to put a link on a table header instead of recording a step that changes nothing', () => {
  const { wb, id } = book();
  const before = wb.toJSON();
  expect(wb.setLink(id, 0, 0, 'https://x.com', 'Item')).toBe(false);
  expect(wb.toJSON()).toEqual(before);
  expect(wb.canUndo()).toBe(false);
  expect(wb.setLink(id, 1, 0, 'https://x.com', 'a')).toBe(true);
  expect(wb.linkAt(id, 1, 0)).toMatchObject({ label: 'a' });
});

it.each(['batch', 'paste'])('turns a formula %s put into a header into the text it shows, so the column is not renamed by its inputs', (how) => {
  const { wb, id, columns } = book();
  wb.setInput(id, 5, 5, 'Amount');
  if (how === 'batch') wb.setCellsWithTableHeaders(id, [{ r: 0, c: 1, cell: { v: null, f: '$F$6' } }], 'Paste');
  else wb.pasteCells(id, [[{ v: null, f: '$F$6' }]], 0, 1, null);
  expect(wb.getCell(id, 0, 1)).toMatchObject({ v: 'Amount', f: null });
  expect(columns()).toEqual(['Item', 'Amount']);
  expect(wb.getCell(id, 4, 4).f).toBe('SUM(T[Amount])');
  expect(wb.getValue(id, 4, 4)).toBe(1);
  wb.setInput(id, 5, 5, 'Other');
  expect(columns()).toEqual(['Item', 'Amount']);
  expect(wb.getValue(id, 4, 4)).toBe(1);
  wb.undo();
  wb.undo();
  expect(columns()).toEqual(['Item', 'Qty']);
  expect(wb.getCell(id, 4, 4).f).toBe('SUM(T[Qty])');
});

it('does the same for a formula header the table grows over by typing beside it', () => {
  const { wb, id, columns } = book();
  wb.setInput(id, 5, 5, 'Tag');
  wb.setInput(id, 0, 2, '=F6');
  expect(columns()).toEqual(['Item', 'Qty', 'Tag']);
  expect(wb.getCell(id, 0, 2)).toMatchObject({ v: 'Tag', f: null });
  wb.setInput(id, 5, 5, 'Other');
  expect(columns()).toEqual(['Item', 'Qty', 'Tag']);
});
