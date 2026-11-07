import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToOds } from '../src/core/io.js';
import { evaluate } from '../src/core/formula/evaluator.js';
import { parseFormula } from '../src/core/formula/parser.js';

// A plain .ods (no app settings) is what other programs read: names come back as exported A1 text.
async function setup(formula, caller = 4) {
  const wb = new Workbook(), id = wb.activeSheetId;
  for (const [i, h] of ['Value', 'Price', 'Result'].entries()) wb.setInput(id, 2, 2 + i, h);
  for (let i = 0; i < 3; i++) {
    wb.setInput(id, i + 3, 2, String((i + 1) * 10));
    wb.setInput(id, i + 3, 3, String(i + 2));
  }
  wb.addTable(id, { r1: 2, c1: 2, r2: 5, c2: 4 }, { name: 'Sales' });
  wb.defineName('Current', formula);
  for (let r = 3; r <= 5; r++) wb.setInput(id, r, caller, '=Current');
  const copy = await workbookFromFile(await workbookToOds(wb, { settings: false }), 'boundary.ods');
  return { wb: copy, id: copy.sheets[0].id, caller };
}

it.each([
  ['SUM([Value])', [60, 60, 60]], ['SUM([@Value])', [10, 20, 30]],
  ['SUM(Sales[@Value])', [10, 20, 30]], ['SUM(Sales[@[Value]:[Price]])', [12, 23, 34]],
].flatMap(([formula, values]) => [0, 1, 2].map((removed) => ({ formula, values, removed }))))(
  'keeps $formula usable after deleting data row $removed', async ({ formula, values, removed }) => {
    const { wb, id, caller } = await setup(formula, formula.includes('Sales') ? 7 : 4);
    const read = () => [3, 4].map((r) => wb.getValue(id, r, caller));
    wb.deleteRows(id, 3 + removed, 1);
    const expected = formula === 'SUM([Value])'
      ? [60 - (removed + 1) * 10, 60 - (removed + 1) * 10]
      : values.filter((_, i) => i !== removed);
    expect(read()).toEqual(expected);
    wb.undo(); expect([3, 4, 5].map((r) => wb.getValue(id, r, caller))).toEqual(values);
    wb.redo(); expect(read()).toEqual(expected);
    const copy = await workbookFromFile(await workbookToOds(wb, { settings: false }), 'deleted.ods');
    expect([3, 4].map((r) => copy.getValue(copy.sheets[0].id, r, caller))).toEqual(expected);
  },
);

it.each([
  ['SUM([@Price])', 4, 2, [2, 3, 4]], ['SUM([Price])', 4, 2, [9, 9, 9]],
  ['SUM([@Value])', 3, 4, [10, 20, 30]], ['SUM([Value])', 3, 4, [60, 60, 60]],
  ['SUM(Sales[@[Value]:[Price]])', 7, 2, [2, 3, 4]],
  ['SUM(Sales[@[Value]:[Price]])', 7, 3, [10, 20, 30]],
])('keeps %s usable after deleting a boundary column', async (formula, caller, removed, expected) => {
  const { wb, id } = await setup(formula, caller);
  const before = [3, 4, 5].map((r) => wb.getValue(id, r, caller));
  wb.deleteCols(id, removed, 1);
  const c = caller > removed ? caller - 1 : caller;
  expect([3, 4, 5].map((r) => wb.getValue(id, r, c))).toEqual(expected);
  wb.undo(); expect([3, 4, 5].map((r) => wb.getValue(id, r, caller))).toEqual(before);
  wb.redo();
  const copy = await workbookFromFile(await workbookToOds(wb, { settings: false }), 'deleted-column.ods');
  expect([3, 4, 5].map((r) => copy.getValue(copy.sheets[0].id, r, c))).toEqual(expected);
});

it('still rejects a current-row reference when its entire source column is deleted', async () => {
  const { wb, id } = await setup('SUM(Sales[@Value])', 7);
  wb.deleteCols(id, 2, 1);
  expect(wb.getValue(id, 3, 6)).toEqual({ error: '#REF!' });
});

it.each(['SUM([@Value])', 'SUM(Sales[@Value])'])('keeps %s live at the first data row', async (formula) => {
  const { wb, id } = await setup(formula);
  wb.insertRows(id, 3, 1);
  wb.setInput(id, 3, 2, '50'); wb.setInput(id, 3, 4, '=Current');
  expect(wb.getValue(id, 3, 4)).toBe(50);
  expect(wb.getValue(id, 4, 4)).toBe(10);
  wb.deleteRows(id, 2, 1);
  expect(wb.getValue(id, 2, 4)).toBe(50);
  expect(wb.getValue(id, 3, 4)).toBe(10);
});

it('reads only the selected data row when evaluating exported range boundaries', async () => {
  const { wb } = await setup('SUM(Sales[@[Value]:[Price]])', 7);
  const reads = [];
  const value = evaluate(parseFormula(wb.names[0].ref), {
    cell: { r: 4, c: 7 }, currentSheet: 'Sheet1', sheetExists: () => true, sheetIndex: () => 1,
    getValue: () => { throw new Error('Boundary lookup read a cell'); },
    getRangeValues: (ref) => {
      reads.push([ref.r1, ref.c1, ref.r2, ref.c2]);
      return [[20, 3]];
    },
  });
  expect(value).toBe(23);
  expect(reads).toEqual([[4, 2, 4, 3]]);
});
