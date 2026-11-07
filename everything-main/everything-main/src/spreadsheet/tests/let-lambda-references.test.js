import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

function setup(input = '42') {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setInput(id, 1, 1, input); wb.setInput(id, 2, 2, '7');
  const calc = (f) => { wb.setInput(id, 5, 5, `=${f}`); return wb.getValue(id, 5, 5); };
  return { wb, id, calc };
}

it.each([
  'LET(x,B2,ROW(x))', 'LET(x,B2,y,x,ROW(y))', 'LET(x,B2,f,LAMBDA(ROW(x)),f())',
  'LAMBDA(x,ROW(x))(B2)', 'LET(f,LAMBDA(x,ROW(x)),f(B2))',
  'ROW(LAMBDA(x,x)(B2))', 'ROW(LAMBDA(B2)())', 'ROW(LET(x,1,B2))',
])('preserves the source row through %s', (formula) => {
  expect(setup().calc(formula)).toBe(2);
});

it.each(['LET(x,B2,', 'LAMBDA(x,'])('retains reference operations in %s bindings', (prefix) => {
  const { calc } = setup();
  const run = (body) => calc(`${prefix}${body})${prefix.startsWith('LAMBDA') ? '(B2)' : ''}`);
  expect(run('COLUMN(x)')).toBe(2);
  expect(run('ISREF(x)')).toBe(true);
  expect(run('OFFSET(x,1,1)')).toBe(7);
  expect(run('SUM((x,C3))')).toBe(49);
});

it('passes cells to named lambdas and retains references in their results', () => {
  const { wb, calc } = setup();
  wb.defineName('Position', '=LAMBDA(x,ROW(x))');
  wb.defineName('Identity', '=LAMBDA(x,x)');
  wb.defineName('FixedCell', '=LAMBDA(B2)');
  expect(calc('Position(B2)')).toBe(2);
  expect(calc('ROW(Identity(B2))')).toBe(2);
  expect(calc('ROW(FixedCell())')).toBe(2);
});

it.each([['42', 42], ['Text', 'Text'], ['TRUE', true], ['', null], ['=1/0', { error: '#DIV/0!' }]])
  ('keeps the value %s while preserving its reference', (input, value) => {
    const { calc } = setup(input);
    expect(calc('LET(x,B2,x)')).toEqual(value ?? 0);
    expect(calc('LAMBDA(x,x)(B2)')).toEqual(value ?? 0);
    expect(calc('LET(x,B2,ISREF(x))')).toBe(true);
    expect(calc('LAMBDA(x,ISREF(x))(B2)')).toBe(true);
    expect(calc('LET(x,B2,IFERROR(x,"error"))')).toEqual(value?.error ? 'error' : value ?? 0);
    expect(calc('LAMBDA(x,ISBLANK(x))(B2)')).toBe(value === null);
  });

it('keeps constants and array values addressless and preserves omitted parameters', () => {
  const { calc } = setup();
  expect(calc('LET(x,42,ISREF(x))')).toBe(false);
  expect(calc('LAMBDA(x,ISREF(x))(42)')).toBe(false);
  expect(calc('LAMBDA(x,ISREF(x))({42})')).toBe(false);
  expect(calc('LET(x,B2+1,ISREF(x))')).toBe(false);
  expect(calc('LAMBDA([x],ISOMITTED(x))()')).toBe(true);
  expect(calc('LAMBDA([x],ISOMITTED(x))(B2)')).toBe(false);
});

it('retains cross-sheet references through nested bindings, updates, and undo', () => {
  const { wb, id, calc } = setup();
  const other = wb.addSheet('Source Data').id;
  wb.setInput(other, 2, 2, '11');
  expect(calc('LET(x,\'Source Data\'!B2,f,LAMBDA(v,OFFSET(v,1,1)),f(x))')).toBe(11);
  wb.setInput(other, 2, 2, '22');
  expect(wb.getValue(id, 5, 5)).toBe(22);
  wb.undo();
  expect(wb.getValue(id, 5, 5)).toBe(11);
});
