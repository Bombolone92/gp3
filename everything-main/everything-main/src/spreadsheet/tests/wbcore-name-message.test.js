import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

// The message understated what a name may hold: letters with their marks, digits, underscores,
// periods, backslashes and question marks after the first character.
it('explains what a defined name may be made of', () => {
  const wb = new Workbook();
  const message = 'Names start with a letter, underscore, or backslash and then use letters, numbers, underscores, periods, backslashes, or question marks';
  expect(wb.validateName('1st')).toBe(message);
  expect(wb.validateName('a b')).toBe(message);
  expect(wb.validateName('a-b')).toBe(message);
  expect(wb.defineName('a b', 'Sheet1!$A$1')).toBe(message);
  expect(wb.validateName('Größe')).toBeNull();
  expect(wb.validateName('_total.2')).toBeNull();
});
