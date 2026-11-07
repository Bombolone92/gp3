import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

const grid = (rows) => rows.flatMap((row, r) => row.map((v, c) => ({ r, c, cell: { v } })));

it('keeps a table\'s filter when its last data rows are deleted, so the buttons return as the table regrows', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, grid([['Name', 'Amt'], ['x', 5], ['y', 7]]));
  const tid = wb.addTable(id, { r1: 0, c1: 0, r2: 2, c2: 1 }, { name: 'T' });
  wb.setFilterCriteria(id, 1, { values: ['5'] });
  expect([...wb.sheet(id).filterHidden]).toEqual([2]);
  wb.clearHistory();
  // Undo restores serialized sheets, which carry the default empty calc map.
  const before = new Workbook(wb.toJSON()).toJSON();
  wb.deleteRows(id, 1, 2);
  expect(wb.tableById(id, tid).range).toEqual({ r1: 0, c1: 0, r2: 0, c2: 1 });
  expect(wb.sheet(id).filter).toEqual({ range: { r1: 0, c1: 0, r2: 0, c2: 1 }, criteria: {} });
  expect(wb.sheet(id).filterHidden.size).toBe(0);
  wb.setInput(id, 1, 0, 'z');
  expect(wb.tableById(id, tid).range).toEqual({ r1: 0, c1: 0, r2: 1, c2: 1 });
  expect(wb.sheet(id).filter.range).toEqual({ r1: 0, c1: 0, r2: 1, c2: 1 });
  expect(wb.isRowHidden(id, 1)).toBe(false);
  wb.undo();
  wb.undo();
  expect(wb.toJSON()).toEqual(before);
});

it('keeps the filter of a table left with only its header and totals rows', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, grid([['Name', 'Amt'], ['x', 5], ['y', 7]]));
  const tid = wb.addTable(id, { r1: 0, c1: 0, r2: 2, c2: 1 }, { name: 'T', totalsRow: true });
  wb.deleteRows(id, 1, 2);
  expect(wb.tableById(id, tid)).toMatchObject({ totalsRow: true, range: { r1: 0, c1: 0, r2: 1, c2: 1 } });
  expect(wb.sheet(id).filter).toEqual({ range: { r1: 0, c1: 0, r2: 0, c2: 1 }, criteria: {} });
  const row = wb.addTableRow(id, tid);
  expect(row).toBe(1);
  expect(wb.sheet(id).filter.range).toEqual({ r1: 0, c1: 0, r2: 1, c2: 1 });
});

it('still drops a plain filter whose data rows are all deleted', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, grid([['Name', 'Amt'], ['x', 5], ['y', 7]]));
  wb.setFilterRange(id, { r1: 0, c1: 0, r2: 2, c2: 1 });
  wb.deleteRows(id, 1, 2);
  expect(wb.sheet(id).filter).toBeNull();
});

it('turns formulas promoted into a table\'s header row into the text they showed', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, grid([['Name', 'Amt', 'Double'], ['x', 5, null], ['y', 7, null]]));
  const tid = wb.addTable(id, { r1: 0, c1: 0, r2: 2, c2: 2 }, { name: 'T' });
  wb.setInput(id, 1, 2, '=[@Amt]*2');
  expect(wb.getValue(id, 2, 2)).toBe(14);
  wb.setInput(id, 5, 5, '=SUM(T[Double])');
  wb.clearHistory();
  const before = new Workbook(wb.toJSON()).toJSON();
  wb.deleteRows(id, 0, 1);
  expect(wb.tableById(id, tid).range).toEqual({ r1: 0, c1: 0, r2: 1, c2: 2 });
  expect(wb.getCell(id, 0, 2)).toMatchObject({ v: '10', f: null });
  expect(wb.tableColumns(id, wb.tableById(id, tid))).toEqual(['x', '5', '10']);
  // References follow the renamed columns, as they do when a header is retyped.
  expect(wb.getCell(id, 1, 2).f).toBe('[@[5]]*2');
  expect(wb.getValue(id, 1, 2)).toBe(14);
  expect(wb.getCell(id, 4, 5).f).toBe('SUM(T[[10]])');
  expect(wb.getValue(id, 4, 5)).toBe(14);
  const row = wb.addTableRow(id, tid);
  wb.setInput(id, row, 1, '3');
  expect(wb.getValue(id, row, 2)).toBe(6);
  wb.undo();
  wb.undo();
  wb.undo();
  expect(wb.toJSON()).toEqual(before);
});

it('renames the column in rules, validations, filter conditions, and defined names when a row is promoted to the header', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, grid([['Item', 'Amt'], ['Name', 'Total'], ['x', 150], ['y', 50]]));
  wb.addTable(id, { r1: 0, c1: 0, r2: 3, c2: 1 }, { name: 'T' });
  wb.addRule(id, { type: 'formula', range: { r1: 2, c1: 0, r2: 3, c2: 0 }, value: '=[@Amt]>100', style: { bold: true } });
  wb.addValidation(id, { type: 'list', range: { r1: 2, c1: 4, r2: 2, c2: 4 }, source: '=T[Item]', strict: true });
  wb.setFilterCriteria(id, 0, { formula: '=[@Amt]>100' });
  wb.defineName('Big', 'SUM(T[Amt])');
  wb.setInput(id, 3, 3, '=Big');
  expect(wb.getValue(id, 3, 3)).toBe(200);
  expect([...wb.sheet(id).filterHidden]).toEqual([3]);
  wb.clearHistory();
  const before = new Workbook(wb.toJSON()).toJSON();
  wb.deleteRows(id, 0, 1);
  const sheet = wb.sheet(id);
  expect(sheet.rules[0]).toMatchObject({ range: { r1: 1, r2: 2 }, value: '=[@Total]>100' });
  expect(wb.conditionalStyle(id, 1, 0, 'x')?.bold).toBe(true);
  expect(wb.conditionalStyle(id, 2, 0, 'y')?.bold).not.toBe(true);
  expect(sheet.validations[0]).toMatchObject({ range: { r1: 1, r2: 1 }, source: '=T[Name]' });
  expect(wb.listOptionsFor(id, sheet.validations[0])).toEqual(['x', 'y']);
  expect(sheet.filter.criteria[0].formula).toBe('=[@Total]>100');
  expect([...sheet.filterHidden]).toEqual([2]);
  expect(wb.names[0].ref).toBe('SUM(T[Total])');
  expect(wb.getValue(id, 2, 3)).toBe(200);
  expect(wb.undoLabels()).toHaveLength(1);
  wb.undo();
  expect(wb.toJSON()).toEqual(before);
});

it('numbers repeated names in a row promoted to a table\'s header, so references keep telling the columns apart', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, grid([['Item', 'Amt'], ['a', 'a'], ['x', 5], ['y', 7]]));
  const tid = wb.addTable(id, { r1: 0, c1: 0, r2: 3, c2: 1 }, { name: 'T' });
  wb.setInput(id, 6, 6, '=SUM(T[Amt])');
  expect(wb.getValue(id, 6, 6)).toBe(12);
  wb.clearHistory();
  const before = new Workbook(wb.toJSON()).toJSON();
  wb.deleteRows(id, 0, 1);
  expect(wb.tableColumns(id, wb.tableById(id, tid))).toEqual(['a', 'a2']);
  expect(wb.getCell(id, 0, 1).v).toBe('a2');
  expect(wb.getCell(id, 5, 6).f).toBe('SUM(T[a2])');
  expect(wb.getValue(id, 5, 6)).toBe(12);
  expect(wb.undoLabels()).toHaveLength(1);
  wb.undo();
  expect(wb.toJSON()).toEqual(before);
});
