import { expect, it } from 'vitest';
import * as XLSX from '../src/vendor/xlsx.mjs';
import { workbookFromFile } from '../src/core/io.js';

// Generators often write a stale or understated <dimension>; SheetJS keeps it as
// the sheet's range while still parsing every cell. Cells outside it were dropped.
it('imports cells stored outside the declared sheet dimension', async () => {
  const ws = XLSX.utils.aoa_to_sheet([[1, null], [null, 'mid'], [null, null, 'corner']]);
  ws.E10 = { t: 'n', v: 42 };
  ws['!ref'] = 'A1:E10';
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, ws, 'Data');
  // Stored (uncompressed) entries let the dimension be understated in place, keeping the zip intact.
  const bytes = new Uint8Array(XLSX.write(book, { bookType: 'xlsx', type: 'array', compression: false }));
  const at = new TextDecoder('latin1').decode(bytes).indexOf('<dimension ref="A1:E10"/>');
  expect(at).toBeGreaterThan(0);
  bytes.set(new TextEncoder().encode('<dimension ref="A1:B99"/>'), at);
  const wb = await workbookFromFile(bytes, 'stale.xlsx');
  const id = wb.activeSheetId;
  expect(wb.getValue(id, 0, 0)).toBe(1);
  expect(wb.getValue(id, 1, 1)).toBe('mid');
  expect(wb.getValue(id, 2, 2)).toBe('corner');
  expect(wb.getValue(id, 9, 4)).toBe(42);
  expect(wb.usedRange(id)).toMatchObject({ r2: 9, c2: 4 });
});
