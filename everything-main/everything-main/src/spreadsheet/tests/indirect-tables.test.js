import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { renderTableSpec } from '../src/core/tables.js';

function setup() {
  const wb = new Workbook(), id = wb.activeSheetId;
  [['Item', 'Qty', 'Price'], ['Pen', '10', '2'], ['Ink', '5', '4']]
    .forEach((row, r) => row.forEach((v, c) => wb.setInput(id, r, c, v)));
  const table = wb.addTable(id, { r1: 0, c1: 0, r2: 2, c2: 2 }, { name: 'Sales' });
  const calc = (formula) => { wb.setInput(id, 5, 5, `=${formula}`); return wb.getValue(id, 5, 5); };
  return { wb, id, table, calc };
}

it.each([['Sales', 21], ['Sales[]', 21], ['Sales[Qty]', 15], ['sales[qty]', 15],
  ['Sales[[Qty]:[Price]]', 21], ['Sales[#Headers]', 0], ['Sales[#All]', 21], ['Sales[[#Headers],[Qty]]', 0]])
  ('resolves the table reference %s through INDIRECT', (ref, expected) => {
    const { calc } = setup();
    expect(calc(`SUM(INDIRECT("${ref}"))`)).toBe(expected);
    expect(calc(`SUM(INDIRECT("${ref}",FALSE))`)).toBe(expected);
    expect(calc(`ISREF(INDIRECT("${ref}"))`)).toBe(true);
  });

it('spills table data across sheets and keeps single-cell header references', () => {
  const { wb, id } = setup();
  const other = wb.addSheet('Report').id;
  wb.setInput(other, 0, 0, '=INDIRECT("Sales")');
  expect(wb.rangeValues(other, { r1: 0, c1: 0, r2: 1, c2: 2 })).toEqual([['Pen', 10, 2], ['Ink', 5, 4]]);
  wb.setInput(other, 4, 0, '=COLUMN(INDIRECT("Sales[[#Headers],[Qty]]"))');
  expect(wb.getValue(other, 4, 0)).toBe(2);
  wb.setInput(id, 1, 1, '12');
  expect(wb.getValue(other, 0, 1)).toBe(12);
  wb.undo();
  expect(wb.getValue(other, 0, 1)).toBe(10);
});

it('follows table growth and selects totals separately from data', () => {
  const { wb, id, table, calc } = setup();
  expect(calc('SUM(INDIRECT("Sales[Qty]"))')).toBe(15);
  const row = wb.addTableRow(id, table);
  wb.setInput(id, row, 1, '7');
  expect(wb.getValue(id, 5, 5)).toBe(22);
  wb.undo();
  expect(wb.getValue(id, 5, 5)).toBe(15);
  wb.redo();
  wb.setTableTotals(id, table, true);
  expect(calc('SUM(INDIRECT("Sales[[#Totals],[Qty]]"))')).toBe(22);
  expect(calc('SUM(INDIRECT("Sales"))')).toBe(28);
  expect(calc('SUM(INDIRECT("Sales[[#All],[Qty]]"))')).toBe(44);
});

it.each(['Sales[@Qty]', '[@Qty]'])('resolves %s using the formula row inside its table', (ref) => {
  const { wb, id } = setup();
  wb.setInput(id, 1, 2, `=INDIRECT("${ref}")`);
  wb.setInput(id, 2, 2, `=INDIRECT("${ref}")`);
  expect(wb.getValue(id, 1, 2)).toBe(10);
  expect(wb.getValue(id, 2, 2)).toBe(5);
});

it('handles escaped column names and retains ordinary named-range lookup', () => {
  const { wb, id, calc } = setup();
  wb.setInput(id, 0, 1, 'Qty[net]');
  const spec = renderTableSpec({ rows: 'data', cols: ['Qty[net]', 'Qty[net]'] });
  expect(calc(`SUM(INDIRECT("Sales[${spec}]"))`)).toBe(15);
  wb.defineName('Rate', 'Sheet1!$C$2');
  expect(calc('INDIRECT("Rate")')).toBe(2);
});

it.each(['Missing[Qty]', 'Sales[Missing]', 'Sales[#Totals]', 'Sales[#Invalid]', 'Sales[Qty]+1',
  'SUM(Sales[Qty])', 'Sales[@Qty]', '[@Qty]', 'Missing'])('returns REF for unresolved or invalid table text %s', (ref) => {
    expect(setup().calc(`INDIRECT("${ref}")`)).toEqual({ error: '#REF!' });
  });
