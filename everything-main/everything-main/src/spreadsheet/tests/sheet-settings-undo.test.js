import { describe, it, expect } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

/**
 * Protect sheet, Gridlines and Show zeros used to change the sheet without recording a step, so the
 * undo depth never grew and the Ctrl+Z that follows one of them undid the edit before it instead —
 * leaving the sheet protected and the switches flipped with everything else back at the start.
 * Every neighbouring sheet setting (tab colour, frozen panes, hidden) records a step.
 */
describe('the sheet settings that used not to be undo steps', () => {
  it('undoes Protect sheet rather than the edit before it', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, 'keep');
    wb.setSheetProtected(id, true);
    expect(wb.undoLabel()).toBe('Protect sheet');
    wb.undo();
    expect(wb.isProtected(id)).toBe(false);
    expect(wb.getValue(id, 0, 0)).toBe('keep');
    wb.redo();
    expect(wb.isProtected(id)).toBe(true);
  });

  it('undoes unprotecting too', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setSheetProtected(id, true);
    wb.setSheetProtected(id, false);
    wb.undo();
    expect(wb.isProtected(id)).toBe(true);
    wb.undo();
    expect(wb.isProtected(id)).toBe(false);
  });

  it('undoes Gridlines and Show zeros one at a time', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, '0');
    wb.setGridlines(id, false);
    wb.setZeros(id, false);
    expect(wb.undoLabel()).toBe('Show zeros');
    wb.undo();
    expect(wb.sheet(id).zeros).toBe(true);
    expect(wb.sheet(id).gridlines).toBe(false);
    wb.undo();
    expect(wb.sheet(id).gridlines).toBe(true);
    expect(wb.getValue(id, 0, 0)).toBe(0);
    wb.redo();
    wb.redo();
    expect(wb.sheet(id).gridlines).toBe(false);
    expect(wb.sheet(id).zeros).toBe(false);
  });

  it('records no step and says nothing when the setting is already what is asked for', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, 'keep');
    const depth = wb._history.length;
    wb.setSheetProtected(id, false);
    wb.setGridlines(id, true);
    wb.setZeros(id, true);
    expect(wb._history.length).toBe(depth);
  });

  it('puts all three on the change record, so a chart is not told to re-read everything', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, '1');
    let v = wb.version;
    wb.setGridlines(id, false);
    expect(wb.changesSince(v)).toEqual([{ version: v + 1, type: 'layout', sheetId: id, box: null, formula: false }]);
    v = wb.version;
    wb.setZeros(id, false);
    expect(wb.changesSince(v)).toHaveLength(1);
    v = wb.version;
    wb.setSheetProtected(id, true);
    expect(wb.changesSince(v)).toEqual([{ version: v + 1, type: 'structure', sheetId: id, box: null, formula: false }]);
  });

  it('keeps the settings a saved file carries', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setSheetProtected(id, true);
    wb.setGridlines(id, false);
    wb.setZeros(id, false);
    const again = new Workbook(wb.toJSON());
    const s = again.sheets[0];
    expect([s.protected, s.gridlines, s.zeros]).toEqual([true, false, false]);
  });
});
