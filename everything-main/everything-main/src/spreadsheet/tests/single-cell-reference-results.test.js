import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

const producers = ['INDIRECT("B2")', 'OFFSET(A1,1,1)', 'INDEX(A1:C3,2,2)'];
const evaluate = (wb, formula) => {
  const id = wb.sheets[0].id;
  wb.setInput(id, 5, 5, `=${formula}`);
  return wb.getValue(id, 5, 5);
};

it.each(producers)('retains the address returned by %s for reference functions', (source) => {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setInput(id, 1, 1, '42');
  wb.setInput(id, 2, 2, '7');
  for (const [formula, expected] of [[`ROW(${source})`, 2], [`COLUMN(${source})`, 2],
    [`ISREF(${source})`, true], [`AREAS(${source})`, 1], [`OFFSET(${source},1,1)`, 7]]) {
    expect(evaluate(wb, formula)).toEqual(expected);
  }
});

it.each(producers.flatMap((source) => [['42', 42], ['Text', 'Text'], ['TRUE', true], ['', null], ['=1/0', { error: '#DIV/0!' }]]
  .map(([input, value]) => ({ source, input, value }))))('preserves $input as the value of $source', ({ source, input, value }) => {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setInput(id, 1, 1, input);
  expect(evaluate(wb, source)).toEqual(value ?? 0);
  expect(evaluate(wb, `ISREF(${source})`)).toBe(true);
  expect(evaluate(wb, `IFERROR(${source},"error")`)).toEqual(value?.error ? 'error' : value ?? 0);
  expect(evaluate(wb, `TYPE(${source})`)).toBe(value?.error ? 16 : typeof value === 'string' ? 2 : typeof value === 'boolean' ? 4 : 1);
  expect(evaluate(wb, `ISNUMBER(${source})`)).toBe(typeof value === 'number');
  expect(evaluate(wb, `ISBLANK(${source})`)).toBe(value === null);
  if (typeof value === 'number') {
    expect(evaluate(wb, `${source}+1`)).toBe(43);
    expect(evaluate(wb, `SUM(${source})`)).toBe(42);
  }
});

it.each(['INDIRECT("\'Source Data\'!B2")', "OFFSET('Source Data'!A1,1,1)", "INDEX('Source Data'!A1:C3,2,2)"])
  ('keeps the source sheet of %s through a nested OFFSET and later edits', (source) => {
    const wb = new Workbook(), id = wb.activeSheetId;
    const other = wb.addSheet('Source Data').id;
    wb.setInput(id, 2, 2, '99');
    wb.setInput(other, 1, 1, '42');
    wb.setInput(other, 2, 2, '7');
    expect(evaluate(wb, `OFFSET(${source},1,1)`)).toBe(7);
    wb.setInput(other, 2, 2, '11');
    expect(wb.getValue(id, 5, 5)).toBe(11);
    wb.undo();
    expect(wb.getValue(id, 5, 5)).toBe(7);
  });

it('retains an INDEX reference for a single-cell source while keeping array values addressless', () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setInput(id, 1, 1, '42');
  expect(evaluate(wb, 'ROW(INDEX(B2,1,1))')).toBe(2);
  expect(evaluate(wb, 'COLUMN(INDEX(B2,1,1))')).toBe(2);
  expect(evaluate(wb, 'INDEX({10,20;30,40},2,2)')).toBe(40);
  expect(evaluate(wb, 'ISREF(INDEX({10,20;30,40},2,2))')).toBe(false);
  expect(evaluate(wb, 'ROW(INDEX({10,20;30,40},2,2))')).toEqual({ error: '#VALUE!' });
});
