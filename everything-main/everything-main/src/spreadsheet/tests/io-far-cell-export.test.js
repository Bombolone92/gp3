import { it, expect } from 'vitest';
import { Workbook, MAX_ROWS, MAX_COLS } from '../src/core/workbook.js';
import { workbookToXlsx, workbookFromFile } from '../src/core/io.js';

// The .xlsx writer used to visit every coordinate inside the sheet's range, so a
// single stray cell in the far corner turned an autosave into 14 million lookups
// (about 16 seconds). It now walks the cells that exist.
it('saves a sheet with one far-off cell in well under a second', async () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.ensureSize(id, MAX_ROWS, MAX_COLS);
  wb.setInput(id, 0, 0, 'near');
  wb.setInput(id, 3, 2, '=A1&"!"');
  wb.setInput(id, MAX_ROWS - 1, MAX_COLS - 1, 'far');
  const started = performance.now();
  const blob = await workbookToXlsx(wb);
  expect(performance.now() - started).toBeLessThan(4000); // generous for a loaded machine; the old walk took ~16 s
  const back = await workbookFromFile(await blob.arrayBuffer(), 'far.xlsx');
  const sheet = back.activeSheetId;
  expect(back.getValue(sheet, 0, 0)).toBe('near');
  expect(back.getValue(sheet, 3, 2)).toBe('near!');
  expect(back.getValue(sheet, MAX_ROWS - 1, MAX_COLS - 1)).toBe('far');
});
