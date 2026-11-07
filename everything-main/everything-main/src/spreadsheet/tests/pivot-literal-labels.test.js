import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { buildPivot, PIVOT_ALL } from '../src/core/pivot.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';

const labels = ['A*', 'ABC', 'A?', 'A1', 'a~b', 'a~~b', 'a~?b', 'a?b', '>5', '=text', 'text', '<x', 'x', 5, true, '5', '05', '5x', 'TRUE', 'FALSE', false, '0', 0, '123\n', '123', '123x', '123\nx', 123];

function source(rows) {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, rows.flatMap((row, r) => row.map((v, c) => ({ r, c, cell: { v, f: null } }))));
  return { wb, id, range: { r1: 0, c1: 0, r2: rows.length - 1, c2: rows[0].length - 1 } };
}

function place(wb, id, spec) {
  const built = buildPivot(wb, id, spec);
  const sheet = wb.addSheet('Pivot');
  wb.setCells(sheet.id, built.cells);
  return { built, sheet, at: (r, c) => wb.getValue(sheet.id, r, c) };
}

it.each([['sum', 30], ['count', 2], ['average', 15], ['min', 10], ['max', 20]])(
  'matches pivot row labels literally for %s', (agg, expected) => {
    const { wb, id, range } = source([['Category', 'Amount'], ...labels.flatMap((label) => [[label, 10], [label, 20]])]);
    const { built, at } = place(wb, id, { range, rowField: 0, valueField: 1, agg });
    expect(built.rowCount).toBe(labels.length);
    for (let r = 1; r <= built.rowCount; r++) expect(at(r, 1), `Category ${at(r, 0)}`).toBe(expected);
    wb.setInput(id, 1, 1, '40');
    const row = Array.from({ length: built.rowCount }, (_, i) => i + 1).find((r) => at(r, 0) === 'A*');
    expect(at(row, 1)).toBe({ sum: 60, count: 2, average: 30, min: 20, max: 40 }[agg]);
  },
);

it('matches column labels literally, including their grand totals', () => {
  const { wb, id, range } = source([['Region', 'Category', 'Amount'], ...labels.map((label, i) => ['West', label, i + 1])]);
  const { at, built } = place(wb, id, { range, rowField: 0, colField: 1, valueField: 2, agg: 'sum' });
  for (let c = 1; c <= built.colCount; c++) {
    const expected = labels.indexOf(at(0, c)) + 1;
    expect(at(1, c), `Category ${at(0, c)}`).toBe(expected);
    expect(at(2, c)).toBe(expected);
  }
});

it('matches filter selections literally as they change and keeps all-values totals', () => {
  const { wb, id, range } = source([['Region', 'Category', 'Amount'], ...labels.map((label, i) => ['West', label, i + 1])]);
  const { at, sheet } = place(wb, id, { range, rowField: 0, valueField: 2, agg: 'sum', filters: [{ field: 1, value: 'A*' }] });
  for (const [i, label] of labels.entries()) {
    wb.setCells(sheet.id, [{ r: 0, c: 1, cell: { v: label, f: null } }]);
    expect(at(3, 1), `Filter ${label}`).toBe(i + 1);
    expect(at(4, 1)).toBe(i + 1);
  }
  wb.setInput(sheet.id, 0, 1, PIVOT_ALL);
  expect(at(4, 1)).toBe(labels.length * (labels.length + 1) / 2);
});

it('keeps literal matching live after editing a label and saving as xlsx', async () => {
  const { wb, id, range } = source([['Category', 'Amount'], ['ABC', 10], ['A*', 20], ['a~b', 30]]);
  const { sheet, at } = place(wb, id, { range, rowField: 0, valueField: 1, agg: 'sum' });
  wb.setInput(sheet.id, 1, 0, 'ABC');
  expect(at(1, 1)).toBe(10);
  wb.setInput(sheet.id, 1, 0, 'A*');
  expect(at(1, 1)).toBe(20);
  wb.undo();
  expect(at(1, 1)).toBe(10);
  wb.redo();
  expect(at(1, 1)).toBe(20);
  const back = await workbookFromFile(await workbookToXlsx(wb), 'pivot.xlsx');
  const pivotId = back.sheetByName('Pivot').id;
  expect(back.getValue(pivotId, 1, 1)).toBe(20);
  back.setInput(pivotId, 1, 0, 'a~b');
  expect(back.getValue(pivotId, 1, 1)).toBe(30);
});

it('keeps whitespace-distinct category labels so their source rows are not lost', () => {
  const categories = ['East', ' East', 'East ', ' EAST ', ' '];
  const { wb, id, range } = source([['Category', 'Amount'], ...categories.map((label, i) => [label, i + 1])]);
  const { built, at } = place(wb, id, { range, rowField: 0, valueField: 1, agg: 'sum' });
  expect(built.rowCount).toBe(categories.length);
  const counts = new Map(Array.from({ length: built.rowCount }, (_, i) => [at(i + 1, 0), at(i + 1, 1)]));
  for (const [i, label] of categories.entries()) expect(counts.get(label), JSON.stringify(label)).toBe(i + 1);
  expect(at(built.rowCount + 1, 1)).toBe(15);
});

it('offers and matches filter values with their original whitespace', () => {
  const categories = ['East', ' East', 'East '];
  const { wb, id, range } = source([['Region', 'Category', 'Amount'], ...categories.map((label, i) => ['West', label, i + 1])]);
  const { built, sheet, at } = place(wb, id, { range, rowField: 0, valueField: 2, agg: 'sum', filters: [{ field: 1, value: 'East ' }] });
  expect(built.filterCells[0].values).toEqual(expect.arrayContaining(categories));
  expect(at(0, 1)).toBe('East ');
  for (const [i, label] of categories.entries()) {
    wb.setCells(sheet.id, [{ r: 0, c: 1, cell: { v: label, f: null } }]);
    expect(at(3, 1)).toBe(i + 1);
  }
});

it('keeps numeric and boolean-looking text categories separate from their typed counterparts', () => {
  const { wb, id, range } = source([['Category', 'Amount'], ...labels.map((label, i) => [label, i + 1])]);
  const { built, at } = place(wb, id, { range, rowField: 0, valueField: 1, agg: 'sum' });
  for (let r = 1; r <= built.rowCount; r++) {
    const label = at(r, 0);
    expect(at(r, 1), `Category ${typeof label}: ${JSON.stringify(label)}`).toBe(labels.indexOf(label) + 1);
  }
});
