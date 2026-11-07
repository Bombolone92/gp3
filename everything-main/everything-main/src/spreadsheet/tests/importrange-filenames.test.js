import { expect, it } from 'vitest';
import { IMPORT_EXTENSIONS } from '../src/core/io.js';
import { resolveImportPath } from '../src/core/importrange.js';
import { ensureXlsx } from '../src/lib/puter.js';

it.each(IMPORT_EXTENSIONS)('keeps the supported %s extension for local names and explicit paths', (ext) => {
  for (const suffix of [ext, ext.toUpperCase()]) {
    const name = `Budget 2026${suffix}`;
    expect(resolveImportPath(` ${name} `, 'Spreadsheets', ensureXlsx)).toBe(`Spreadsheets/${name}`);
    expect(resolveImportPath(`Work/${name}`, 'Spreadsheets', ensureXlsx)).toBe(`Work/${name}`);
    expect(resolveImportPath(`/nj/Work/${name}`, 'Spreadsheets', ensureXlsx)).toBe(`/nj/Work/${name}`);
  }
});

// "Reports/Q1.2024" was taken to end in an extension and never got its .xlsx.
it('treats a suffix of digits alone as part of a path\'s name, not an extension', () => {
  expect(resolveImportPath('Reports/Q1.2024', 'Spreadsheets', ensureXlsx)).toBe('Reports/Q1.2024.xlsx');
  expect(resolveImportPath('/nj/Reports/Sales.2026', 'Spreadsheets', ensureXlsx)).toBe('/nj/Reports/Sales.2026.xlsx');
  expect(resolveImportPath('Reports/Q1.2024.xlsx', 'Spreadsheets', ensureXlsx)).toBe('Reports/Q1.2024.xlsx');
  expect(resolveImportPath('Reports/Archive.7z', 'Spreadsheets', ensureXlsx)).toBe('Reports/Archive.7z');
});

it('retains extension inference and cleanup for workbook titles', () => {
  expect(resolveImportPath('Budget', 'Spreadsheets', ensureXlsx)).toBe('Spreadsheets/Budget.xlsx');
  expect(resolveImportPath('Budget.v1', 'Spreadsheets', ensureXlsx)).toBe('Spreadsheets/Budget.v1.xlsx');
  expect(resolveImportPath('Budget\u0001', 'Spreadsheets', ensureXlsx)).toBe('Spreadsheets/Budget.xlsx');
  expect(resolveImportPath('Budget\u0001.xlsx', 'Spreadsheets', ensureXlsx)).toBe('Spreadsheets/Budget.xlsx');
  expect(resolveImportPath('Work/Budget', 'Spreadsheets', ensureXlsx)).toBe('Work/Budget.xlsx');
  expect(resolveImportPath('Work/Budget.dat', 'Spreadsheets', ensureXlsx)).toBe('Work/Budget.dat');
  expect(resolveImportPath('', 'Spreadsheets', ensureXlsx)).toBeNull();
});
