import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

function setup(input = '42') {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setInput(id, 0, 0, 'Qty'); wb.setInput(id, 0, 1, 'Price');
  wb.setInput(id, 1, 0, input); wb.setInput(id, 1, 1, '7');
  const table = wb.addTable(id, { r1: 0, c1: 0, r2: 1, c2: 1 }, { name: 'Sales' });
  wb.defineName('Amount', 'Sheet1!$A$2');
  const calc = (formula) => { wb.setInput(id, 5, 5, `=${formula}`); return wb.getValue(id, 5, 5); };
  return { wb, id, table, calc };
}

it.each([['Amount', 2, 7], ['Sales[Qty]', 2, 7], ['Sales[[#Headers],[Qty]]', 1, 'Price']])
  ('retains the single-cell source address of %s', (source, row, adjacent) => {
    const { calc } = setup();
    expect(calc(`ROW(${source})`)).toBe(row);
    expect(calc(`COLUMN(${source})`)).toBe(1);
    expect(calc(`ISREF(${source})`)).toBe(true);
    expect(calc(`AREAS(${source})`)).toBe(1);
    expect(calc(`OFFSET(${source},0,1)`)).toBe(adjacent);
    expect(calc(`ROW(INDEX(${source},1,1))`)).toBe(row);
  });

it.each(['Amount', 'Sales[Qty]'].flatMap((source) => [['42', 42], ['Text', 'Text'], ['TRUE', true], ['', null], ['=1/0', { error: '#DIV/0!' }]]
  .map(([input, value]) => ({ source, input, value }))))('retains $input as the value and reference of $source', ({ source, input, value }) => {
    const { calc } = setup(input);
    expect(calc(source)).toEqual(value ?? 0);
    expect(calc(`ISREF(${source})`)).toBe(true);
    expect(calc(`ROW(${source})`)).toBe(2);
    expect(calc(`IFERROR(${source},"error")`)).toEqual(value?.error ? 'error' : value ?? 0);
    expect(calc(`TYPE(${source})`)).toBe(value?.error ? 16 : typeof value === 'string' ? 2 : typeof value === 'boolean' ? 4 : 1);
    expect(calc(`ISBLANK(${source})`)).toBe(value === null);
  });

it('combines single-cell named and table references in unions', () => {
  const { calc } = setup();
  expect(calc('SUM((Amount,Sales[Qty]))')).toBe(84);
  expect(calc('AREAS((Amount,Sales[Qty]))')).toBe(2);
  expect(calc('ROW(INDEX((Amount,Sales[Qty]),1,1,2))')).toBe(2);
});

it('retains current-row and totals references', () => {
  const { wb, id, table, calc } = setup();
  wb.setInput(id, 1, 1, '=ROW([@Qty])+COLUMN([@Qty])');
  expect(wb.getValue(id, 1, 1)).toBe(3);
  wb.setTableTotals(id, table, true);
  expect(calc('ROW(Sales[[#Totals],[Qty]])')).toBe(3);
  expect(calc('ISREF(Sales[[#Totals],[Qty]])')).toBe(true);
});

it('keeps cross-sheet named references live through edits and undo', () => {
  const { wb, calc } = setup();
  const other = wb.addSheet('Other').id;
  wb.setInput(other, 1, 1, '11');
  wb.defineName('Remote', 'Other!$A$2');
  expect(calc('OFFSET(Remote,0,1)')).toBe(11);
  wb.setInput(other, 1, 1, '22');
  expect(wb.getValue(wb.sheets[0].id, 5, 5)).toBe(22);
  wb.undo();
  expect(wb.getValue(wb.sheets[0].id, 5, 5)).toBe(11);
});

it('keeps constants and local bindings distinct from named references', () => {
  const { wb, calc } = setup();
  wb.defineName('Tax', '=0.2');
  expect(calc('Tax*Amount')).toBe(8.4);
  expect(calc('ISREF(Tax)')).toBe(false);
  expect(calc('ROW(Tax)')).toEqual({ error: '#VALUE!' });
  expect(calc('LET(Amount,99,ISREF(Amount))')).toBe(false);
  expect(calc('LET(Amount,99,Amount+1)')).toBe(100);
});
