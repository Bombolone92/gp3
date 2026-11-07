import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookToOds, workbookFromFile } from '../src/core/io.js';

// The ODS writer used to emit one element per coordinate of the sheet's
// rectangle, so a single far-off cell cost hundreds of megabytes.
it('writes a sheet with one far-off cell as a small .ods by repeating its empty rows and cells', async () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, 'near');
  wb.setInput(id, 1, 1, '=A1&"!"');
  wb.mergeCells(id, { r1: 3, c1: 0, r2: 4, c2: 2 });
  wb.setInput(id, 3, 0, 'merged');
  wb.setInput(id, 19999, 701, 'far');
  const t0 = performance.now();
  const blob = await workbookToOds(wb);
  expect(performance.now() - t0).toBeLessThan(5000);
  expect(blob.size).toBeLessThan(100000);
  const back = await workbookFromFile(await blob.arrayBuffer(), 'far.ods');
  const bid = back.activeSheetId;
  expect(back.getValue(bid, 0, 0)).toBe('near');
  expect(back.getValue(bid, 1, 1)).toBe('near!');
  expect(back.getValue(bid, 3, 0)).toBe('merged');
  expect(back.sheets[0].merges).toEqual([{ r1: 3, c1: 0, r2: 4, c2: 2 }]);
  expect(back.getValue(bid, 19999, 701)).toBe('far');
  expect(back.sheets[0].cells.size).toBe(4);
});
