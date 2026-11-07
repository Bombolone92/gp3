// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { formatBytes } from '../src/ui/dom.js';
import { sanitizeName, ensureXlsx } from '../src/lib/puter.js';

// A size just under a megabyte read "1024 KB", and anything from a gigabyte up was given in thousands of MB.
it('shows a size in the unit its rounded figure belongs to, up to gigabytes', () => {
  expect(formatBytes(null)).toBe('');
  expect(formatBytes(0)).toBe('0 B');
  expect(formatBytes(1023)).toBe('1023 B');
  expect(formatBytes(1024)).toBe('1.0 KB');
  expect(formatBytes(1536)).toBe('1.5 KB');
  expect(formatBytes(10240)).toBe('10 KB');
  expect(formatBytes(1048575)).toBe('1.0 MB');
  expect(formatBytes(1048576)).toBe('1.0 MB');
  expect(formatBytes(1073741823)).toBe('1.0 GB');
  expect(formatBytes(5e9)).toBe('4.7 GB');
  expect(formatBytes(3.5e12)).toBe('3.2 TB');
});

// A name ending in a dot was kept as typed ("Budget." became Budget..xlsx), a file Windows cannot hold once downloaded.
it('drops the dots and spaces a file name ends with', () => {
  expect(sanitizeName('Budget. ')).toBe('Budget');
  expect(sanitizeName('  ..hidden..  ')).toBe('..hidden');
  expect(sanitizeName('...')).toBe('');
  expect(sanitizeName('Q3.5')).toBe('Q3.5');
  expect(sanitizeName('Budget.xlsx')).toBe('Budget.xlsx');
  expect(ensureXlsx('Budget.')).toBe('Budget.xlsx');
});
