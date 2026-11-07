import { expect, it } from 'vitest';
import { calc } from './helpers/calc.js';
import { compareValues } from '../src/core/formula/functions.js';
import { Workbook } from '../src/core/workbook.js';

// Text was compared by code unit, which put every accented letter after z: "é"<"f" was FALSE and
// SORT({"f";"é";"z"}) gave f, z, é, while the Sort dialog already puts accented letters beside
// their base letters. Formulas compare text in the same dictionary order now.
it.each([
  ['"é"<"f"', true],
  ['"ä"<"b"', true],
  ['"a"<"é"', true],
  ['"e"<"é"', true],
  ['"É"="é"', true],
  ['"e"="é"', false],
  ['"é"<>"e"', true],
  ['"ø"<"p"', true],
  ['"ñ"<"o"', true],
  ['"a"<"B"', true],
  ['"Z"<"a"', false],
  ['"apple"="APPLE"', true],
  ['"apple"<"Apple"', false],
  ['"a"<"a1"', true],
  ['"10"<"9"', true],
  ['"a b"<"ab"', true],
  ['"ß"="ss"', true], // corroborated by native Excel worksheet comparisons
  ['"ß"<"t"', true],
  ['1<"a"', true],
  ['"a"<TRUE', true],
])('%s is %s', (formula, expected) => {
  expect(calc(formula)).toBe(expected);
});

it('sorts and looks up text in dictionary order', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '=SORT({"f";"é";"z";"a";"E"})');
  expect([0, 1, 2, 3, 4].map((r) => wb.getValue(id, r, 0))).toEqual(['a', 'E', 'é', 'f', 'z']);
  expect(calc('MATCH("é",{"a";"é";"f"},1)')).toBe(2);
  expect(calc('MATCH("f",{"a";"é";"f"},1)')).toBe(3);
  expect(calc('MAX(IF({"f";"é";"z"}<"g",1,0))')).toBe(1);
  expect(calc('SUMPRODUCT(--({"f";"é";"z"}<"g"))')).toBe(2);
});

it('agrees with the collator on letters, digits and spaces, which it compares without one', () => {
  const collator = new Intl.Collator(undefined, { sensitivity: 'accent', ignorePunctuation: false });
  const words = ['a', 'B', 'c1', 'c 1', '10', '9', 'ab', 'Ab', 'abc', ' a', 'z9', 'Z 9', 'é', 'Ab1'];
  for (const x of words) for (const y of words) {
    expect(Math.sign(compareValues(x, y))).toBe(Math.sign(collator.compare(x.toLowerCase(), y.toLowerCase())));
  }
});
