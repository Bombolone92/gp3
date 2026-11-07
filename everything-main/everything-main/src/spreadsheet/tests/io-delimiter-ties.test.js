import { afterEach, expect, it } from 'vitest';
import { detectDelimiter, workbookFromFile } from '../src/core/io.js';
import { setLocale } from '../src/core/format.js';

afterEach(() => setLocale('en-US'));

// A file of plain decimal-comma numbers separated by semicolons scores the same for ',' and
// ';', and the tie went to the reader's locale, so an English reader had every number split
// at its decimal comma. The separator leaving fewer fields unreadable as values wins the tie.
it('splits a semicolon-separated file of decimal-comma numbers on the semicolons in a dot-decimal locale', async () => {
  const source = '1,5;2,5\n3,5;4,5\n';
  expect(detectDelimiter(source, 'numbers.csv')).toBe(';');
  const wb = await workbookFromFile(new TextEncoder().encode(source), 'numbers.csv');
  const id = wb.activeSheetId;
  expect(wb.activeSheet.cells.size).toBe(4);
  expect(wb.getValue(id, 0, 0)).toBe('1,5');
  expect(wb.getValue(id, 1, 1)).toBe('4,5');
});

it('picks the separator whose fields read as values when the counts tie', () => {
  expect(detectDelimiter('1;2,5\n3;4,5', 'a.csv')).toBe(';');
  expect(detectDelimiter('1.5,2;3.5,4\n', 'b.csv')).toBe(',');
});

it('still falls back to the locale\'s separator when the fields are text under both', () => {
  expect(detectDelimiter('a,b;c,d\ne,f;g,h', 'text.csv')).toBe(',');
  setLocale('de-DE');
  expect(detectDelimiter('a,b;c,d\ne,f;g,h', 'text.csv')).toBe(';');
  expect(detectDelimiter('1,5;2,5\n3,5;4,5', 'numbers.csv')).toBe(';');
  expect(detectDelimiter('1.5,2.5\n3.5,4.5', 'dots.csv')).toBe(',');
});
