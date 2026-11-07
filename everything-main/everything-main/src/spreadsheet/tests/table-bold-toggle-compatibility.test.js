import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';

// The Bold control edits the direct font, not the table's
// differential font. Toggling it on and off leaves table headers/totals bold.
// Do not infer an explicit table-style override from a cleared direct flag.
it.each(['blue', 'custom'])('retains %s table bold after toggling the direct font, including save/reopen and undo', async style => {
  const wb = new Workbook({ sheets: [{ cells: { '2,3': { v: 'Item' }, '3,3': { v: 'Entry' }, '4,3': { v: 'Total' } },
    tables: [{ name: 'Items', range: { r1: 2, c1: 3, r2: 4, c2: 3 }, totalsRow: true, style,
      ...(style === 'custom' ? { customStyle: { headerRow: { bold: true }, totalRow: { bold: true } } } : {}) }] }] });
  const id = wb.activeSheetId;
  const bold = (book, r) => !!(book.styleAt(book.activeSheetId, r, 3)?.bold || book.conditionalStyle(book.activeSheetId, r, 3, book.getValue(book.activeSheetId, r, 3))?.bold);
  for (const r of [2, 3, 4]) {
    const range = { r1: r, c1: 3, r2: r, c2: 3 };
    wb.toggleStyle(id, range, 'bold', { r, c: 3 });
    expect(wb.styleAt(id, r, 3).bold).toBe(true);
    wb.toggleStyle(id, range, 'bold', { r, c: 3 });
    expect(wb.styleAt(id, r, 3)?.bold).toBeFalsy();
    expect(bold(wb, r)).toBe(r !== 3);
    wb.undo(); expect(wb.styleAt(id, r, 3).bold).toBe(true);
    wb.redo(); expect(bold(wb, r)).toBe(r !== 3);
  }
  const saved = await workbookFromFile(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), 'tables.xlsx');
  expect([2, 3, 4].map(r => bold(saved, r))).toEqual([true, false, true]);
});
