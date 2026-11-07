import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

const size = (wb, id) => [wb.sheet(id).rows, wb.sheet(id).cols];

// Undoing or redoing a structural step reloaded a whole-workbook snapshot, rows and columns
// included, so a sheet grown by scrolling snapped back to the snapshot's size with the viewport
// left past its end. Growing the grid is no part of a structural step, as protection and the view
// switches are not (those are undo steps of their own; see sheet-settings-undo.test.js).
describe('undoing and redoing a structural edit', () => {
  it('keeps every sheet at the size it has grown to since', () => {
    const wb = new Workbook();
    const one = wb.activeSheetId;
    const two = wb.addSheet('Two').id;
    wb.setInput(one, 0, 0, 'top');
    wb.insertRows(one, 0, 1);
    wb.ensureSize(one, 400, 30);
    wb.ensureSize(two, 500, 26);
    wb.undo();
    expect(wb.getValue(one, 0, 0)).toBe('top');
    expect(size(wb, one)).toEqual([400, 30]);
    expect(size(wb, two)).toEqual([500, 26]);
    wb.redo();
    expect(wb.getValue(one, 1, 0)).toBe('top');
    expect(size(wb, one)).toEqual([400, 30]);
    expect(size(wb, two)).toEqual([500, 26]);
    // Growth between the undo and the redo is kept as well: redo does not shrink the sheet either.
    wb.undo();
    wb.ensureSize(one, 700, 40);
    wb.redo();
    expect(size(wb, one)).toEqual([700, 40]);
    // The step itself still undoes: the inserted row goes and the reached extent stays.
    wb.undo();
    expect(wb.getValue(one, 0, 0)).toBe('top');
    expect(size(wb, one)).toEqual([700, 40]);
  });

  it('still restores a step\'s own rows and columns exactly, so a sheet never scrolled out round-trips', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    const [rows] = size(wb, id);
    wb.insertRows(id, 0, 2);
    expect(size(wb, id)[0]).toBe(rows + 2);
    const inserted = wb.toJSON();
    wb.undo();
    expect(size(wb, id)[0]).toBe(rows);
    wb.redo();
    expect(wb.toJSON()).toEqual(inserted);
    wb.deleteRows(id, 0, 10);
    expect(size(wb, id)[0]).toBe(rows + 2 - 10);
    wb.undo();
    expect(size(wb, id)[0]).toBe(rows + 2);
    wb.redo();
    expect(size(wb, id)[0]).toBe(rows + 2 - 10);
    // Once scrolled out, though, neither the redo of the deletion nor its undo shrinks the sheet again.
    wb.ensureSize(id, 300, 26);
    wb.undo();
    expect(size(wb, id)[0]).toBe(300);
    wb.redo();
    expect(size(wb, id)[0]).toBe(300);
    // The reached extent is view state, not part of the file.
    expect(JSON.stringify(wb.toJSON())).not.toContain('reached');
  });

  it('leaves a cell edit\'s undo alone, which never touched the size', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.ensureSize(id, 800, 26);
    wb.setInput(id, 0, 0, 'x');
    wb.undo();
    expect(size(wb, id)).toEqual([800, 26]);
  });
});
