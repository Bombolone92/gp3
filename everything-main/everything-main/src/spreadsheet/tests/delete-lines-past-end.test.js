import { describe, it, expect } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

// Deleting a band that runs past the sheet's last row or column used to
// shrink the sheet by the whole requested count, hiding rows that still held
// data behind a size smaller than their index.
describe('deleting lines that run past the end of the sheet', () => {
  it('removes only the rows that exist', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    const rows = wb.sheet(id).rows;
    wb.setInput(id, 0, 0, 'top');
    wb.setInput(id, rows - 11, 0, 'near the end');
    wb.deleteRows(id, rows - 10, 50);
    expect(wb.sheet(id).rows).toBe(rows - 10);
    expect(wb.getValue(id, rows - 11, 0)).toBe('near the end');
    wb.deleteRows(id, 50, 1000);
    expect(wb.sheet(id).rows).toBe(50);
    expect(wb.getValue(id, 0, 0)).toBe('top');
  });

  it('removes only the columns that exist and ignores a band beyond it', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    const cols = wb.sheet(id).cols;
    wb.deleteCols(id, cols - 6, 10);
    expect(wb.sheet(id).cols).toBe(cols - 6);
    const version = wb.version;
    wb.deleteCols(id, cols + 5, 3);
    expect(wb.version).toBe(version);
  });

  it('still empties the sheet when every line is deleted', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 3, 0, 'x');
    wb.deleteRows(id, 0, wb.sheet(id).rows + 5);
    expect(wb.getValue(id, 3, 0)).toBeNull();
    expect(wb.sheet(id).rows).toBeGreaterThan(1);
  });
});
