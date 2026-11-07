import { describe, expect, it } from 'vitest';
import { DEFAULT_COL_WIDTH, DEFAULT_ROW_HEIGHT, Workbook } from '../src/core/workbook.js';

// Setting an unset column or row to the default size compared the stored size (none) with the
// default and found them different, so it recorded a "Resize column" step that undid nothing and
// dirtied the document, which autosave then wrote unchanged.
describe('resizing a line to the size it already has', () => {
  it('records no undo step and leaves the document clean when the line is at the default', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.markClean();
    wb.setColWidth(id, 0, DEFAULT_COL_WIDTH);
    wb.setColWidth(id, 1, DEFAULT_COL_WIDTH + 0.4); // rounds to the default
    wb.setRowHeight(id, 0, DEFAULT_ROW_HEIGHT);
    wb.setRowHeight(id, 2, Math.round(DEFAULT_ROW_HEIGHT));
    expect(wb.canUndo()).toBe(false);
    expect(wb.dirty).toBe(false);
    expect(wb.sheet(id).colWidths.size).toBe(0);
    expect(wb.sheet(id).rowHeights.size).toBe(0);
  });

  it('still records a change to and from the default, which undo and redo follow', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.markClean();
    wb.setColWidth(id, 0, 150);
    expect(wb.canUndo()).toBe(true);
    expect(wb.dirty).toBe(true);
    wb.setColWidth(id, 0, DEFAULT_COL_WIDTH);
    expect(wb.colWidth(id, 0)).toBe(DEFAULT_COL_WIDTH);
    expect(wb.sheet(id).colWidths.size).toBe(0);
    wb.undo();
    expect(wb.colWidth(id, 0)).toBe(150);
    wb.undo();
    expect(wb.colWidth(id, 0)).toBe(DEFAULT_COL_WIDTH);
    expect(wb.canUndo()).toBe(false);
    wb.redo();
    wb.redo();
    expect(wb.colWidth(id, 0)).toBe(DEFAULT_COL_WIDTH);
    expect(wb.canRedo()).toBe(false);
    // Rows the same way.
    wb.setRowHeight(id, 0, 40);
    wb.setRowHeight(id, 0, DEFAULT_ROW_HEIGHT);
    wb.undo();
    expect(wb.rowHeight(id, 0)).toBe(40);
    wb.undo();
    expect(wb.rowHeight(id, 0)).toBe(DEFAULT_ROW_HEIGHT);
  });
});
