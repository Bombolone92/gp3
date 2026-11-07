// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile } from '../src/core/io.js';
import { MAX_ROW, MAX_COL } from '../src/core/refs.js';
import { openImportPlacementDialog, truncationNote } from '../src/ui/importdialog.js';
import { closeAllModals } from '../src/ui/modal.js';

vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));

// A delimited file longer or wider than the grid lost its last rows and columns without a word,
// so the sheet looked as though the file ended where the data does. What did not fit is counted
// now and said where the import is described.

const read = (text, name) => workbookFromFile(new TextEncoder().encode(text), name);

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  document.body.innerHTML = '<div id="app"></div>';
});
afterEach(() => { closeAllModals(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

it('counts the rows of a text file that reach past the grid', async () => {
  const wb = await read(`${'\n'.repeat(MAX_ROW + 1)}past,one\npast,two\n`, 'long.csv');
  expect(wb.importTruncated).toEqual({ rows: 2, cols: 0 });
  expect(truncationNote(wb)).toBe(' The file held 2 rows past the grid, which could not be read.');
}, 60000);

it('counts the fields of a row that reach past the last column, and keeps the rest', async () => {
  const wb = await read(`${Array.from({ length: MAX_COL + 7 }, (_, i) => `v${i}`).join(',')}\n`, 'wide.csv');
  expect(wb.importTruncated).toEqual({ rows: 0, cols: 6 });
  expect(wb.sheets[0].cells.size).toBe(MAX_COL + 1);
  expect(wb.getValue(wb.activeSheetId, 0, MAX_COL)).toBe(`v${MAX_COL}`);
  expect(truncationNote(wb)).toBe(' The file held 6 columns past the grid, which could not be read.');
}, 60000);

it('says nothing for a file that fits, or one whose extra fields are empty', async () => {
  const fits = await read('a,b\nc,d\n', 'small.csv');
  expect(fits.importTruncated).toBeUndefined();
  expect(truncationNote(fits)).toBe('');
  const ragged = await read(`a,b${','.repeat(MAX_COL + 5)}\n`, 'ragged.csv');
  expect(ragged.importTruncated).toBeUndefined();
});

it('tells the import dialog\'s summary what would not fit, in every placement', () => {
  const other = new Workbook();
  other.setInput(other.activeSheetId, 0, 0, 'a');
  other.importTruncated = { rows: 1234, cols: 0 };
  const wb = new Workbook();
  const id = wb.activeSheetId;
  const ctx = { wb, sheetId: () => id, active: () => ({ r: 0, c: 0 }), grid: { focus() {} } };
  const modal = openImportPlacementDialog(ctx, other, 'long.csv');
  const hint = () => modal.panel.querySelector('.field-hint').textContent;
  expect(hint()).toContain('The file held 1,234 rows past the grid, which could not be read.');
  modal.panel.querySelector('input[value="append"]').click();
  expect(hint()).toContain('The file held 1,234 rows past the grid, which could not be read.');
});
