import { expect, it } from 'vitest';
import { formatWithCode } from '../src/core/numfmt.js';
import { getLocale, setLocale } from '../src/core/format.js';
import { Workbook } from '../src/core/workbook.js';

it.each([
  [0, '0.???', '0.   '],
  [1, '0.???', '1.   '],
  [1.2, '0.???', '1.2  '],
  [1.23, '0.???', '1.23 '],
  [1.234, '0.???', '1.234'],
  [-1.2, '0.???', '-1.2  '],
  [1.2, '0.0??', '1.2  '],
  [1, '0.??#', '1.  '],
  [1, '0.?#?', '1.  '],
  [1, '0.#??', '1.  '],
  [1, '0.???" kg"', '1.    kg'],
  [1.2, '0.0"x"??', '1.2x  '],
  [1, '0.#"x"?', '1.x '],
  [1, '0.?"x"#', '1. x'],
  [1, '0.?#"x"?', '1. x '],
  [1, '0.#?0', '1.000'],
  [1, '0.###', '1.'],
  [1.2301, '0.???', '1.23 '],
  [1.9999, '0.???', '2.   '],
  [0.012, '0.???%', '1.2  %'],
  [12000, '0.???E+00', '1.2  E+04'],
  [-1.2, '0.???;[Red](0.???)', '(1.2  )'],
])('preserves each optional decimal position for %s with %s', (value, code, expected) => {
  expect(formatWithCode(value, code)).toBe(expected);
});

it('preserves alignment for long decimal formats', () => {
  expect(formatWithCode(0, `0.${'?'.repeat(200)}`)).toBe(`0.${' '.repeat(200)}`);
});

it('uses the locale decimal mark without losing alignment spaces', () => {
  const previous = getLocale();
  try {
    setLocale('de-DE');
    expect(formatWithCode(1.2, '0.???')).toBe('1,2  ');
  } finally { setLocale(previous); }
});

it('keeps cell display and TEXT padding consistent without modifying stored values', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '1.2');
  wb.applyStyle(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, { fmt: 'custom', code: '0.???' });
  wb.setInput(id, 0, 1, '=TEXT(A1,"0.???")');
  expect(wb.getDisplay(id, 0, 0)).toBe('1.2  ');
  expect(wb.getValue(id, 0, 1)).toBe('1.2  ');
  expect(wb.getValue(id, 0, 0)).toBe(1.2);
});
