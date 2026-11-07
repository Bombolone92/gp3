import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

function fill(wb, id, n) {
  const entries = [];
  for (let i = 0; i < n; i++) entries.push({ r: i, c: 0, cell: { v: i, f: null } });
  wb.setCells(id, entries, 'fill');
}

// Structural edits keep whole-workbook snapshots for undo, up to 200 of them: 100 row
// insertions on a 50,000-cell sheet held over half a gigabyte.
describe('the memory structural undo steps keep', () => {
  it('drops the oldest steps once their snapshots would hold more cells than the budget', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    fill(wb, id, 20);
    wb.clearHistory();
    wb._snapshotBudget = 50;
    wb.insertRows(id, 0, 1);
    wb.insertRows(id, 0, 1);
    wb.insertRows(id, 0, 1);
    expect(wb._history.length).toBe(2); // 20 cells a snapshot: three would hold 60
    expect(wb.getCell(id, 3, 0).v).toBe(0);
    wb.undo();
    wb.undo();
    expect(wb.canUndo()).toBe(false);
    expect(wb.getCell(id, 1, 0).v).toBe(0); // the first insertion stays
    wb.redo();
    expect(wb.getCell(id, 2, 0).v).toBe(0);
    // A cell edit holds its one cell before and after, next to nothing beside a snapshot of the sheet.
    wb.setInput(id, 50, 0, '1');
    wb.setInput(id, 51, 0, '2');
    expect(wb._history.length).toBe(3);
    expect(wb.undoLabels(3).slice(0, 2)).toEqual(['Edit cell', 'Edit cell']);
    expect(wb.undoLabels(3)[2]).toMatch(/^Insert row/);
  });

  it('starts over when the book is replaced, so a restored version or draft has its full undo history', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    const entries = [];
    for (let r = 0; r < 1000; r++) for (let c = 0; c < 100; c++) entries.push({ r, c, cell: { v: r * c, f: null } });
    wb.setCells(id, entries, 'fill');
    for (let i = 0; i < 8; i++) wb.addSheet();
    expect(wb._history).toHaveLength(9);
    // Eight snapshots of a 100,000-cell sheet: the budget for structural steps is nearly spent.
    wb.replaceWith(wb.toJSON());
    expect(wb.canUndo()).toBe(false);
    // The replaced book's steps are all that count: twelve mixed edits leave twelve steps, as in a book just opened.
    for (let i = 0; i < 6; i++) { wb.setInput(wb.activeSheetId, 0, i, 'x'); wb.addSheet(); }
    expect(wb._history).toHaveLength(12);
    expect(wb.undoLabels(12).filter((label) => label === 'Edit cell')).toHaveLength(6);
  });

  it('counts a transaction of structural steps once, and keeps a lone step however large', () => {
    const wb = new Workbook();
    const a = wb.activeSheetId;
    const b = wb.addSheet('Two').id;
    fill(wb, a, 20);
    fill(wb, b, 20);
    wb.clearHistory();
    wb._snapshotBudget = 30; // less than one snapshot of both sheets
    wb.transaction('Insert rows', () => { wb.insertRows(a, 0, 1); wb.insertRows(a, 0, 1); });
    expect(wb._history.length).toBe(1);
    wb.transaction('Insert rows', () => { wb.insertRows(a, 0, 1); wb.insertRows(a, 0, 1); });
    expect(wb._history.length).toBe(1); // the older step made way
    expect(wb.getCell(a, 4, 0).v).toBe(0);
    wb.undo();
    expect(wb.getCell(a, 2, 0).v).toBe(0);
    expect(wb.canUndo()).toBe(false);
  });
});
