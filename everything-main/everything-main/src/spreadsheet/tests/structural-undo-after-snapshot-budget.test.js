import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

function fill(wb, id, n) {
  const entries = [];
  for (let i = 0; i < n; i++) entries.push({ r: i, c: 0, cell: { v: i, f: null } });
  wb.setCells(id, entries, 'fill');
}

// A structural step keeps the workbook from before it; its first undo takes a second snapshot, of the
// state after it, for redo. That second snapshot was never counted against the budget the steps'
// snapshots share, so undone and redone steps held twice the memory the budget allowed for.
describe('the after snapshot a structural undo takes', () => {
  it('counts against the snapshot budget once taken, so a redone step is weighed with both its snapshots', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    fill(wb, id, 20);
    wb.clearHistory();
    wb._snapshotBudget = 50;
    wb.insertRows(id, 0, 1);
    expect(wb._snapshotCells).toBe(20);
    wb.undo();
    expect(wb._snapshotCells).toBe(0); // an undone step is not counted while it waits in the redo list
    wb.redo();
    expect(wb._snapshotCells).toBe(40); // before and after, both held now
    expect(wb.getCell(id, 1, 0).v).toBe(0);
    // The next structural step would bring the total to 60: the redone step, holding two snapshots, makes way.
    wb.insertRows(id, 0, 1);
    expect(wb._history.length).toBe(1);
    expect(wb._snapshotCells).toBe(20);
    expect(wb.getCell(id, 2, 0).v).toBe(0);
  });

  it('evicts the oldest steps on redo when the redone step brings the snapshots over budget', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    fill(wb, id, 20);
    wb.clearHistory();
    wb._snapshotBudget = 50;
    wb.insertRows(id, 0, 1);
    wb.insertRows(id, 0, 1);
    expect(wb._snapshotCells).toBe(40);
    wb.undo();
    wb.undo();
    expect(wb._snapshotCells).toBe(0);
    wb.redo();
    expect(wb._snapshotCells).toBe(40);
    expect(wb._history.length).toBe(1);
    wb.redo();
    // 80 cells would be held: the older step goes, the one just redone stays however large.
    expect(wb._history.length).toBe(1);
    expect(wb._snapshotCells).toBe(40);
    expect(wb.getCell(id, 2, 0).v).toBe(0);
    wb.undo();
    expect(wb.getCell(id, 1, 0).v).toBe(0); // back to the state after the first insertion, which can no longer be undone
    expect(wb.canUndo()).toBe(false);
    expect(wb._snapshotCells).toBe(0);
  });

  it('counts a transaction of structural steps with both its snapshots once redone', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    fill(wb, id, 20);
    wb.clearHistory();
    wb._snapshotBudget = 100;
    wb.transaction('Insert rows', () => { wb.insertRows(id, 0, 1); wb.insertRows(id, 0, 1); wb.setInput(id, 0, 0, 'top'); });
    expect(wb._snapshotCells).toBe(20);
    wb.undo();
    expect(wb._snapshotCells).toBe(0);
    expect(wb.getCell(id, 0, 0).v).toBe(0);
    wb.redo();
    expect(wb._snapshotCells).toBe(41); // the after snapshot holds the inserted rows' one typed cell too
    expect(wb.getCell(id, 0, 0).v).toBe('top');
    expect(wb.getCell(id, 2, 0).v).toBe(0);
    // Undone a second time the snapshot is already there: nothing is taken or counted twice.
    wb.undo();
    expect(wb._snapshotCells).toBe(0);
    wb.redo();
    expect(wb._snapshotCells).toBe(41);
    expect(wb.getCell(id, 0, 0).v).toBe('top');
  });

  it('leaves a step that was never undone counted once, as before', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    fill(wb, id, 20);
    wb.clearHistory();
    for (let i = 0; i < 5; i++) wb.insertRows(id, 0, 1);
    expect(wb._snapshotCells).toBe(100);
    expect(wb._history.length).toBe(5);
  });
});
