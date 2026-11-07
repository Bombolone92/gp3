import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';

const grid = (rows) => rows.flatMap((row, r) => row.map((v, c) => ({ r, c, cell: { v } })));

/** Sheet1 reads table T on sheet Two from a formula, a rule, a validation, a filter condition, a name, and a calculated column. */
function setup() {
  const wb = new Workbook();
  const one = wb.activeSheetId;
  const two = wb.addSheet('Two').id;
  wb.setCells(two, grid([['Item', 'Amt'], ['x', 5], ['y', 7]]));
  wb.addTable(two, parseRange('A1:B3'), { name: 'T' });
  wb.setCells(one, grid([['Qty', 'Share'], [1, null], [2, null]]));
  const own = wb.addTable(one, parseRange('A1:B3'), { name: 'Own' });
  wb.setInput(one, 1, 1, '=[@Qty]/SUM(T[Amt])');
  wb.setInput(one, 0, 3, '=SUM(T[Amt])');
  wb.setInput(one, 0, 4, '=SUM(T)');
  wb.setInput(one, 0, 5, '=SUM(Own[Qty])');
  wb.addRule(one, { type: 'formula', range: parseRange('D1:D1'), value: '=SUM(T[Amt])>10', style: { bold: true } });
  wb.addValidation(one, { type: 'list', range: parseRange('G1:G1'), source: '=T[Item]', strict: true });
  wb.setFilterCriteria(one, 0, { formula: '=A2<SUM(T[Amt])' });
  wb.defineName('Big', 'SUM(T[Amt])');
  wb.setInput(one, 0, 7, '=Big');
  expect([wb.getValue(one, 0, 3), wb.getValue(one, 0, 4), wb.getValue(one, 0, 7), wb.getValue(one, 2, 1)]).toEqual([12, 12, 12, 2 / 12]);
  wb.clearHistory();
  return { wb, one, two, own };
}

it('turns references to a deleted sheet\'s tables into #REF!, as references to its cells read', () => {
  const { wb, one, two, own } = setup();
  // Undo restores serialized sheets, which carry the default empty calc map.
  const before = new Workbook(wb.toJSON()).toJSON();
  expect(wb.deleteSheet(two)).toBe(true);
  const sheet = wb.sheet(one);
  expect(wb.getCell(one, 0, 3).f).toBe('SUM(#REF!)');
  expect(wb.getValue(one, 0, 3)).toEqual({ error: '#REF!' });
  expect(wb.getCell(one, 0, 4).f).toBe('SUM(#REF!)');
  expect(wb.getValue(one, 0, 4)).toEqual({ error: '#REF!' });
  expect(wb.getCell(one, 0, 5).f).toBe('SUM(Own[Qty])');
  expect(wb.getValue(one, 0, 5)).toBe(3);
  expect(wb.getCell(one, 1, 1).f).toBe('[@Qty]/SUM(#REF!)');
  expect(wb.tableById(one, own).calc[1]).toBe('[@Qty]/SUM(#REF!)');
  expect(sheet.rules[0].value).toBe('=SUM(#REF!)>10');
  expect(sheet.validations[0].source).toBe('=#REF!');
  expect(sheet.filter.criteria[0].formula).toBe('=A2<SUM(#REF!)');
  expect(wb.names[0].ref).toBe('SUM(#REF!)');
  expect(wb.getValue(one, 0, 7)).toEqual({ error: '#REF!' });
  wb.undo();
  expect(wb.toJSON()).toEqual(before);
  expect(wb.getValue(one, 0, 3)).toBe(12);
});
