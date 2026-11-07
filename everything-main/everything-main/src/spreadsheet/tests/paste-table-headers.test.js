import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

const modes = ['text', 'cells', 'transpose', 'formulas', 'skipBlanks', 'formatting', 'arithmetic'];

function setup() {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setCells(id, [[1, 2, 'Total'], [10, 20, null]].flatMap((row, r) => row.map((v, c) => ({ r, c, cell: { v, f: null } }))));
  const table = wb.addTable(id, { r1: 0, c1: 0, r2: 1, c2: 2 }, { name: 'Sales' });
  wb.setInput(id, 1, 2, '=[@[1]]+10*[@[2]]');
  const other = wb.addSheet('Summary').id;
  wb.setInput(other, 0, 0, '=SUM(Sales[1])');
  wb.setInput(other, 1, 0, '=SUM(Sales[2])');
  wb.protectRange(other, { r1: 0, c1: 0, r2: 1, c2: 0 });
  wb.clearHistory();
  return { wb, id, table, other };
}

function paste(wb, id, mode) {
  if (mode === 'text') return wb.pasteValues(id, [['2', '1']], 0, 0);
  if (mode === 'formatting') return wb.pasteStyles(id, [[{ s: { fmt: 'number', dec: 2 } }]], 0, 0, { r1: 0, c1: 0, r2: 0, c2: 1 });
  if (mode === 'arithmetic') return wb.pasteOperation(id, [[1, -1]], 0, 0, 'add');
  const cells = mode === 'transpose' ? [[{ v: 2 }], [{ v: 1 }]] : [[{ v: 2 }, { v: 1 }]];
  return wb.pasteCells(id, cells, 0, 0, null, null, { transpose: mode === 'transpose', keepStyles: mode === 'formulas', skipBlanks: mode === 'skipBlanks' });
}

it.each(modes)('keeps column identities and calculated templates when %s paste changes headers', (mode) => {
  const { wb, id, table, other } = setup();
  // Headers are text: a table made over the numbers 1 and 2 names its columns "1" and "2".
  expect(wb.getCell(id, 0, 0)).toMatchObject({ v: '1', f: null });
  const before = wb.toJSON();
  paste(wb, id, mode);
  // So a number format pasted over them changes nothing they show, and an arithmetic paste passes them over.
  const renamed = mode !== 'formatting' && mode !== 'arithmetic';
  const names = renamed ? ['2', '1'] : ['1', '2'];
  expect(wb.tableColumns(id, wb.tableById(id, table))).toEqual([...names, 'Total']);
  expect(wb.getCell(other, 0, 0).f).toBe(renamed ? `SUM(Sales[[${names[0]}]])` : 'SUM(Sales[1])');
  expect(wb.getCell(other, 1, 0).f).toBe(renamed ? `SUM(Sales[[${names[1]}]])` : 'SUM(Sales[2])');
  expect(wb.getValue(other, 0, 0)).toBe(10);
  expect(wb.getValue(other, 1, 0)).toBe(20);
  expect(wb.getValue(id, 1, 2)).toBe(210);
  expect(wb.undoLabels()).toHaveLength(mode === 'arithmetic' ? 0 : 1);
  if (mode !== 'arithmetic') {
    wb.undo(); expect(wb.toJSON()).toEqual(before);
    wb.redo(); expect(wb.getValue(id, 1, 2)).toBe(210);
  }
  const row = wb.addTableRow(id, table);
  wb.setInput(id, row, 0, '3'); wb.setInput(id, row, 1, '4');
  expect(wb.getValue(id, row, 2)).toBe(43);
});

it.each(modes)('keeps headers and dependents unchanged when %s paste is refused', (mode) => {
  const { wb, id } = setup();
  wb.protectRange(id, { r1: 0, c1: 1, r2: 0, c2: 1 });
  wb.clearHistory();
  const before = wb.toJSON();
  paste(wb, id, mode);
  expect(wb.toJSON()).toEqual(before);
  expect(wb.canUndo()).toBe(false);
});

it('retains references explicitly supplied in a formula pasted with renamed headers', () => {
  const { wb, id, other } = setup();
  wb.pasteCells(id, [[{ v: 2 }, { v: 1 }, { v: 'Total' }, { f: 'SUM(Sales[2])' }]], 0, 0, null);
  expect(wb.getCell(id, 0, 3).f).toBe('SUM(Sales[2])');
  expect(wb.getValue(id, 0, 3)).toBe(10);
  expect(wb.getValue(other, 0, 0)).toBe(10);
});
