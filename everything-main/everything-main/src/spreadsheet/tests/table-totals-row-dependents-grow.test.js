import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';

// Conditional formats, validation rules and charts that end at a table's last data row grow with
// the table, but only through resizeTable: a table with a totals row adds its rows by inserting one
// above the totals row (Add table row, Tab from the last cell, Insert row), which left the rules
// ending at the old last row, and once one addition was missed every later one was missed too.
// Rows inserted above the totals row now grow them as a resize does.
const grid = (rows) => rows.flatMap((row, r) => row.map((v, c) => ({ r, c, cell: { v } })));

function book(totalsRow) {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, grid([['Item', 'Amt', null, 'Other'], ['a', 5, null, 1], ['b', 7, null, 2]]));
  const tid = wb.addTable(id, parseRange('A1:B3'), { name: 'T', totalsRow });
  wb.addRule(id, { type: 'gt', value: 6, range: parseRange('B2:B3'), style: { bold: true } });
  wb.addValidation(id, { type: 'number', min: 0, max: 100, range: parseRange('B2:B3') });
  wb.addChart(id, { type: 'bar', range: parseRange('A1:B3'), anchor: { r: 0, c: 5 } });
  // A rule beside the table, and one ending short of its last row, are no part of it.
  wb.addRule(id, { type: 'gt', value: 1, range: parseRange('D2:D3'), style: { bold: true } });
  wb.addValidation(id, { type: 'number', min: 0, max: 9, range: parseRange('A2:A2') });
  wb.clearHistory();
  // Looked up afresh: a structural undo replaces the sheet object.
  const state = () => ({
    table: wb.tableById(id, tid).range,
    rule: wb.sheet(id).rules[0].range, other: wb.sheet(id).rules[1].range,
    validation: wb.sheet(id).validations[0].range, short: wb.sheet(id).validations[1].range,
    chart: wb.sheet(id).charts[0].range,
  });
  return { wb, id, tid, state };
}

it('grows the rules, validation and chart on a table with a totals row when a row is added, again and again', () => {
  const { wb, id, tid, state } = book(true);
  expect(wb.addTableRow(id, tid)).toBe(3);
  expect(state()).toEqual({ table: parseRange('A1:B5'), rule: parseRange('B2:B4'), other: parseRange('D2:D3'), validation: parseRange('B2:B4'), short: parseRange('A2:A2'), chart: parseRange('A1:B4') });
  expect(wb.addTableRow(id, tid)).toBe(4);
  expect(state()).toMatchObject({ table: parseRange('A1:B6'), rule: parseRange('B2:B5'), validation: parseRange('B2:B5'), chart: parseRange('A1:B5') });
  // Two rows inserted above the totals row by hand grow them by two.
  expect(wb.insertRows(id, 5, 2)).toBe(true);
  expect(state()).toMatchObject({ table: parseRange('A1:B8'), rule: parseRange('B2:B7'), validation: parseRange('B2:B7'), chart: parseRange('A1:B7'), other: parseRange('D2:D3'), short: parseRange('A2:A2') });
  expect(wb.getCell(id, 7, 1)?.f).toMatch(/SUBTOTAL/);
  // The new last data row is under the rule; the totals row itself stays outside it (the table's own coat left aside).
  expect(wb.conditionalStyle(id, 6, 1, 12, { banding: false })?.bold).toBe(true);
  expect(wb.conditionalStyle(id, 7, 1, 12, { banding: false })?.bold).toBeUndefined();
  expect(wb.undoLabels()).toHaveLength(3);
  expect(wb.undoLabel()).toBe('Insert rows');
  wb.undo(); wb.undo(); wb.undo();
  expect(state()).toEqual({ table: parseRange('A1:B4'), rule: parseRange('B2:B3'), other: parseRange('D2:D3'), validation: parseRange('B2:B3'), short: parseRange('A2:A2'), chart: parseRange('A1:B3') });
  wb.redo();
  expect(state()).toMatchObject({ table: parseRange('A1:B5'), rule: parseRange('B2:B4'), validation: parseRange('B2:B4'), chart: parseRange('A1:B4') });
});

it('grows them the same way as a table without a totals row', () => {
  const { wb, id, tid, state } = book(false);
  expect(wb.addTableRow(id, tid)).toBe(3);
  expect(state()).toEqual({ table: parseRange('A1:B4'), rule: parseRange('B2:B4'), other: parseRange('D2:D3'), validation: parseRange('B2:B4'), short: parseRange('A2:A2'), chart: parseRange('A1:B4') });
});

it('keeps a filtered table with a totals row growing its filter and its rules together', () => {
  const { wb, id, state } = book(true);
  wb.setFilterCriteria(id, 1, { op: 'gt', value: 6 });
  expect([...wb.sheet(id).filterHidden]).toEqual([1]);
  expect(wb.insertRows(id, 3, 1)).toBe(true);
  expect(wb.sheet(id).filter.range).toEqual(parseRange('A1:B4'));
  expect([...wb.sheet(id).filterHidden]).toEqual([1]);
  expect(state()).toMatchObject({ table: parseRange('A1:B5'), rule: parseRange('B2:B4'), validation: parseRange('B2:B4'), chart: parseRange('A1:B4') });
  // A row inserted elsewhere (inside the data, or under the totals row) leaves the ranges to the structural edit.
  expect(wb.insertRows(id, 6, 1)).toBe(true);
  expect(state()).toMatchObject({ table: parseRange('A1:B5'), rule: parseRange('B2:B4') });
});
