import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

// A name past the 255-character limit failed the spelling pattern, whose length bound it was, and was told
// to start with a letter, which it did.
it('refuses a name longer than 255 characters with a message that says so', () => {
  const wb = new Workbook();
  expect(wb.validateName('a'.repeat(255))).toBeNull();
  expect(wb.validateName('a'.repeat(256))).toBe('Names are at most 255 characters');
  // Length is judged first, before spelling or reserved words.
  expect(wb.validateName(`${'a'.repeat(300)}!`)).toBe('Names are at most 255 characters');
  expect(wb.validateName('Größe'.repeat(60))).toBe('Names are at most 255 characters');
  expect(wb.defineName('a'.repeat(256), 'Sheet1!$A$1')).toBe('Names are at most 255 characters');
  expect(wb.names).toEqual([]);
  expect(wb.validateName(`1${'a'.repeat(300)}`)).toBe('Names are at most 255 characters');
  expect(wb.validateName('1abc')).toBe('Names start with a letter, underscore, or backslash and then use letters, numbers, underscores, periods, backslashes, or question marks');
});
