import { expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { evaluate } from '../src/core/formula/evaluator.js';
import { parseFormula } from '../src/core/formula/parser.js';

const sources = ['CHOOSE(1,B2,C3)', 'CHOOSE(2,C3,B2)', 'IF(TRUE,B2,C3)', 'IF(FALSE,C3,B2)'];
function setup(input = '42') {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setInput(id, 1, 1, input);
  wb.setInput(id, 2, 2, '7');
  const calc = (formula) => { wb.setInput(id, 5, 5, `=${formula}`); return wb.getValue(id, 5, 5); };
  return { wb, id, calc };
}

it.each(sources)('preserves the selected reference in %s', (source) => {
  const { calc } = setup();
  expect(calc(`ROW(${source})`)).toBe(2);
  expect(calc(`COLUMN(${source})`)).toBe(2);
  expect(calc(`ISREF(${source})`)).toBe(true);
  expect(calc(`OFFSET(${source},1,1)`)).toBe(7);
});

it.each(['CHOOSE(1,B2,1/0)', 'IF(TRUE,B2,1/0)'])('retains cell values and error references in %s', (source) => {
  for (const [input, expected] of [['42', 42], ['Text', 'Text'], ['TRUE', true], ['', null], ['=1/0', { error: '#DIV/0!' }]]) {
    const { calc } = setup(input);
    expect(calc(source)).toEqual(expected ?? 0);
    expect(calc(`ISREF(${source})`)).toBe(true);
    expect(calc(`IFERROR(${source},"error")`)).toEqual(expected?.error ? 'error' : expected ?? 0);
  }
});

it.each(['CHOOSE(1,B2,C3)', 'IF(TRUE,B2,C3)', 'IF(FALSE,C3,B2)'])('does not read the unselected cell in %s', (formula) => {
  const getValue = vi.fn(() => 42);
  const value = evaluate(parseFormula(formula), { currentSheet: 'Sheet1', getValue });
  expect(value.ref).toMatchObject({ r1: 1, c1: 1 });
  expect(getValue).toHaveBeenCalledTimes(1);
});

it.each(['CHOOSE(1,42,B2)', 'IF(TRUE,42,B2)', 'CHOOSE(1,{42},B2)', 'IF(TRUE,B2+0,C3)'])
  ('does not invent an address for %s', (source) => {
    expect(setup().calc(`ISREF(${source})`)).toBe(false);
  });

it.each(['CHOOSE(1,\'Source Data\'!B2,C3)', 'IF(FALSE,C3,\'Source Data\'!B2)'])
  ('keeps cross-sheet addresses through edits and undo for %s', (source) => {
    const { wb, id, calc } = setup();
    const other = wb.addSheet('Source Data').id;
    wb.setInput(other, 2, 2, '11');
    expect(calc(`OFFSET(${source},1,1)`)).toBe(11);
    wb.setInput(other, 2, 2, '22');
    expect(wb.getValue(id, 5, 5)).toBe(22);
    wb.undo();
    expect(wb.getValue(id, 5, 5)).toBe(11);
  });

it('keeps cell conditions scalar and array conditions elementwise', () => {
  const { wb, id, calc } = setup();
  wb.setInput(id, 0, 0, 'TRUE');
  expect(calc('ROW(IF(A1,B2,C3))')).toBe(2);
  expect(calc('SUM(IF({TRUE,FALSE},B2,C3))')).toBe(49);
  expect(calc('SUM(CHOOSE(1,B2:C3))')).toBe(49);
});
