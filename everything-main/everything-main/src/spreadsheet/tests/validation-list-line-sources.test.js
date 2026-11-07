import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { isRangeSource, describeValidation } from '../src/core/validation.js';

function book() {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  const lists = wb.addSheet('Lists');
  ['a', 'b', 'c'].forEach((v, r) => wb.setInput(lists.id, r, 0, v));
  wb.setInput(lists.id, 0, 1, '={"x";"y"}');
  ['p', 'q', 'r'].forEach((v, r) => wb.setInput(id, r, 2, v));
  const rule = (source) => {
    wb.addValidation(id, { type: 'list', source, range: { r1: 0, c1: 0, r2: 0, c2: 0 } });
    return wb.validationAt(id, 0, 0);
  };
  return { wb, id, lists, rule };
}

it.each([
  ['Lists!A:A', ['a', 'b', 'c']],
  ['Lists!$A:$A', ['a', 'b', 'c']],
  ["'Lists'!A:A", ['a', 'b', 'c']],
  ['Lists!B1#', ['x', 'y']],
  ['C:C', ['p', 'q', 'r']],
  ['$C:$C', ['p', 'q', 'r']],
  ['1:3', ['p', 'q', 'r']],
])('reads a list source written as %s as the cells it names, not as one literal option', (source, options) => {
  const { wb, id, rule } = book();
  expect(isRangeSource(source)).toBe(true);
  const v = rule(source);
  expect(wb.listOptionsFor(id, v)).toEqual(options);
  expect(wb.validateValue(id, 0, 0, options[0]).ok).toBe(true);
  expect(wb.validateValue(id, 0, 0, 'nope').ok).toBe(false);
  expect(describeValidation(v)).toBe(`List from ${source}`);
});

it('follows a spill reference as the array behind it grows', () => {
  const { wb, id, lists, rule } = book();
  const v = rule('Lists!B1#');
  wb.setInput(lists.id, 0, 1, '={"x";"y";"z"}');
  expect(wb.listOptionsFor(id, v)).toEqual(['x', 'y', 'z']);
  expect(wb.validateValue(id, 0, 0, 'z').ok).toBe(true);
});

it('still reads a bare name or plain words as literal options', () => {
  expect(isRangeSource('Opts')).toBe(false);
  expect(isRangeSource('Yes, No')).toBe(false);
  expect(isRangeSource('A1')).toBe(false);
  expect(isRangeSource('A:B, C')).toBe(false);
  expect(isRangeSource('Lists!A1,Other')).toBe(false);
});
