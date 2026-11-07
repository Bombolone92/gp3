import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';

const grid = (rows) => rows.flatMap((row, r) => row.map((v, c) => ({ r, c, cell: { v } })));

/** Table T over A1:B3 with a calculated column, a filter hiding row 3, and formulas at D1:D2 reading it by name and by address. */
function setup() {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, grid([['Item', 'Amt', 'Double'], ['x', 5, null], ['y', 7, null]]));
  const tid = wb.addTable(id, parseRange('A1:C3'), { name: 'T' });
  wb.setInput(id, 1, 2, '=[@Amt]*2');
  wb.setInput(id, 0, 4, '=SUM(T[Amt])');
  wb.setInput(id, 1, 4, '=SUM(B2:B3)');
  wb.setFilterCriteria(id, 1, { values: ['5'] });
  expect([...wb.sheet(id).filterHidden]).toEqual([2]);
  expect(wb.getValue(id, 2, 2)).toBe(14);
  wb.clearHistory();
  return { wb, id, tid, before: new Workbook(wb.toJSON()).toJSON() };
}

it('moves a table with its cells when the whole table is dragged, keeping its name, columns, filter, and templates', () => {
  const { wb, id, tid, before } = setup();
  expect(wb.moveRange(id, parseRange('A1:C3'), 4, 5)).toEqual(parseRange('F5:H7'));
  const t = wb.tableById(id, tid);
  expect(t.range).toEqual(parseRange('F5:H7'));
  expect(wb.tableColumns(id, t)).toEqual(['Item', 'Amt', 'Double']);
  expect(t.calc[2]).toBe('[@Amt]*2');
  expect(wb.getCell(id, 0, 4).f).toBe('SUM(T[Amt])');
  expect(wb.getValue(id, 0, 4)).toBe(12);
  expect(wb.getCell(id, 1, 4).f).toBe('SUM(G6:G7)');
  expect(wb.getValue(id, 1, 4)).toBe(12);
  expect(wb.sheet(id).filter).toMatchObject({ range: parseRange('F5:H7'), criteria: { 6: { values: ['5'] } } });
  expect([...wb.sheet(id).filterHidden]).toEqual([6]);
  expect(wb.tableAt(id, 0, 0)).toBeNull();
  const row = wb.addTableRow(id, tid);
  wb.setInput(id, row, 6, '3');
  expect(wb.getValue(id, row, 7)).toBe(6);
  wb.undo();
  wb.undo();
  wb.undo();
  expect(wb.toJSON()).toEqual(before);
});

it('moves a table by cut and paste, to another sheet too', () => {
  const { wb, id, tid } = setup();
  const two = wb.addSheet('Two').id;
  const cells = wb.copyRange(id, parseRange('A1:C3'));
  expect(wb.placeMoved(two, 1, 1, cells, { sheetId: id, range: parseRange('A1:C3') })).toEqual(parseRange('B2:D4'));
  expect(wb.sheet(id).tables).toEqual([]);
  expect(wb.sheet(id).filter).toBeNull();
  const t = wb.tableById(two, tid);
  expect(t.range).toEqual(parseRange('B2:D4'));
  expect(t.calc[2]).toBe('[@Amt]*2');
  expect(wb.getValue(two, 3, 3)).toBe(14);
  expect(wb.getValue(id, 0, 4)).toBe(12);
  expect(wb.getCell(id, 1, 4).f).toBe('SUM(Two!C3:C4)');
  expect(wb.sheet(two).filter).toMatchObject({ range: parseRange('B2:D4'), criteria: { 2: { values: ['5'] } } });
  expect([...wb.sheet(two).filterHidden]).toEqual([3]);
  expect(wb.undoLabels()).toEqual(['Move cells', 'Add sheet']);
  wb.undo();
  expect(wb.tableById(id, tid).range).toEqual(parseRange('A1:C3'));
  expect(wb.sheet(two).tables).toEqual([]);
  expect(wb.getValue(id, 2, 2)).toBe(14);
});

it('refuses a move that would tear a table, taking some of its cells along with cells outside it', () => {
  const { wb, id } = setup();
  const before = wb.toJSON();
  expect(wb.moveRange(id, parseRange('A1:D2'), 5, 5)).toBeNull();
  const cells = wb.copyRange(id, parseRange('A1:D2'));
  expect(wb.placeMoved(id, 5, 5, cells, { sheetId: id, range: parseRange('A1:D2') })).toBeNull();
  expect(wb.toJSON()).toEqual(before);
  expect(wb.canUndo()).toBe(false);
  // Cells within the table still move on their own, as before.
  expect(wb.moveRange(id, parseRange('B2'), 8, 8)).toEqual(parseRange('I9'));
  expect(wb.getValue(id, 8, 8)).toBe(5);
});

it('refuses to land a moved table on another table', () => {
  const { wb, id } = setup();
  wb.setCells(id, grid([[null, null, null, null, null, 'Other'], [null, null, null, null, null, 1]]));
  wb.addTable(id, parseRange('F1:F2'), { name: 'Other' });
  const before = wb.toJSON();
  expect(wb.moveRange(id, parseRange('A1:C3'), 0, 4)).toBeNull();
  expect(wb.toJSON()).toEqual(before);
});
