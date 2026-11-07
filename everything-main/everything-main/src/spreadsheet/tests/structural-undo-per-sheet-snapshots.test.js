import { describe, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

// A structural step (a row inserted, a sheet renamed or hidden, a group collapsed) kept a snapshot of the whole
// workbook and reloaded the whole workbook on undo: its cost grew with the cells on every other sheet, every
// formula in the book was parsed again after an undo, and on a book past the snapshot budget one such step
// evicted the rest of the history. A step now keeps only the sheets it changed; the others stay as they are.

function fillSheet(wb, id, rows, cols = 10, formula = (r) => `A${r + 1}*2`) {
  wb.ensureSize(id, rows + 5, cols + 2);
  const entries = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) entries.push({ r, c, cell: c === cols - 1 && formula ? { v: null, f: formula(r) } : { v: r * 10 + c, f: null } });
  wb.setCells(id, entries, 'fill');
}

/** Sheet1 with 2,000 cells and `others` sheets of 20,000 cells each, one formula column apiece. */
function book(others) {
  const wb = new Workbook();
  const first = wb.sheets[0].id;
  fillSheet(wb, first, 200);
  const ids = [];
  for (let k = 0; k < others; k++) { const id = wb.addSheet(`Data${k + 1}`).id; fillSheet(wb, id, 2000); ids.push(id); }
  wb.clearHistory();
  return { wb, first, ids };
}

describe('a structural step on one sheet of a large book', () => {
  it('serializes that sheet and no other, and leaves the other sheets as they are through undo and redo', () => {
    const { wb, first, ids } = book(5);
    const toJSON = vi.spyOn(wb, 'toJSON');
    const stores = ids.map((id) => wb.sheet(id).cells);
    wb.insertRows(first, 0, 1);
    expect(toJSON).not.toHaveBeenCalled();
    expect(wb._snapshotCells).toBe(2000); // the 2,000 cells of Sheet1, not the 102,000 of the book
    expect(wb.getCell(first, 1, 0).v).toBe(0);
    wb.undo();
    expect(wb.getCell(first, 0, 0).v).toBe(0);
    expect(wb.getCell(first, 0, 9).f).toBe('A1*2');
    ids.forEach((id, i) => expect(wb.sheet(id).cells).toBe(stores[i]));
    wb.redo();
    expect(wb._snapshotCells).toBe(4000); // before and after, of the one sheet
    expect(wb.getCell(first, 1, 9).f).toBe('A2*2');
    expect(wb.getValue(ids[2], 1999, 9)).toBe(19990 * 2);
    ids.forEach((id, i) => expect(wb.sheet(id).cells).toBe(stores[i]));
    expect(toJSON).not.toHaveBeenCalled();
  }, 60000);

  it('parses no formula again after an undo but the ones no cell held, on the changed sheet or any other', () => {
    const { wb, first } = book(3);
    expect(wb.hasVolatileFormulas()).toBe(false); // every formula in the book parsed once
    wb.insertRows(first, 0, 1);
    const ast = vi.spyOn(wb, '_ast');
    wb.undo();
    wb.hasVolatileFormulas();
    // 6,200 formulas: the three data sheets' cells are the very same, and Sheet1's read =A{r+1}*2 at row r before
    // the insertion as after it, so the trees carry over; only =A1*2, which no cell held after it, is parsed.
    expect(ast.mock.calls.length).toBeLessThanOrEqual(2);
    expect(wb.getValue(first, 5, 9)).toBe(100);
  }, 60000);

  it('keeps the cell edits made before a structural step on a book past the snapshot budget', () => {
    const wb = new Workbook();
    const first = wb.sheets[0].id;
    fillSheet(wb, first, 200);
    for (let k = 0; k < 60; k++) fillSheet(wb, wb.addSheet(`M${k + 1}`).id, 2000, 10, null);
    expect(wb.sheets.reduce((n, s) => n + s.cells.size, 0)).toBe(1_202_000);
    wb.clearHistory();
    for (let i = 0; i < 5; i++) wb.setInput(first, 300 + i, 0, `e${i}`);
    wb.insertRows(first, 0, 1);
    expect(wb.undoLabels()).toEqual(['Insert rows', 'Edit cell', 'Edit cell', 'Edit cell', 'Edit cell', 'Edit cell']);
    expect(wb._snapshotCells).toBe(2015); // Sheet1's cells, the five typed ones among them, and those five steps' own before-and-after pairs
    wb.setSheetHidden(wb.sheets[1].id, true);
    expect(wb.undoLabels(7)).toEqual(['Hide sheet', 'Insert rows', 'Edit cell', 'Edit cell', 'Edit cell', 'Edit cell', 'Edit cell']);
    expect(wb._snapshotCells).toBe(2015); // hiding a sheet changes the sheet list, not the sheet: none of its 20,000 cells is held
    wb.renameSheet(wb.sheets[2].id, 'Renamed');
    expect(wb._snapshotCells).toBe(2015);
    wb.undo();
    wb.undo();
    expect(wb.sheets[1].hidden).toBe(false);
    expect(wb.sheets[2].name).toBe('M2');
  }, 120000);

  it('keeps the other sheet whose formulas the insertion moved, and puts them back on undo', () => {
    const { wb, first, ids } = book(2);
    wb.setInput(ids[0], 0, 11, '=Sheet1!A5+1');
    wb.clearHistory();
    const untouched = wb.sheet(ids[1]).cells;
    wb.insertRows(first, 0, 2);
    expect(wb.getCell(ids[0], 0, 11).f).toBe('Sheet1!A7+1');
    expect(wb._snapshotCells).toBe(2000 + 20001); // Sheet1 and the sheet that names it, not the third
    wb.undo();
    expect(wb.getCell(ids[0], 0, 11).f).toBe('Sheet1!A5+1');
    expect(wb.getValue(ids[0], 0, 11)).toBe(41);
    expect(wb.sheet(ids[1]).cells).toBe(untouched);
    wb.redo();
    expect(wb.getCell(ids[0], 0, 11).f).toBe('Sheet1!A7+1');
    expect(wb.getValue(ids[0], 0, 11)).toBe(41);
  }, 60000);

  it('holds the edits a transaction makes on other sheets after its structural step', () => {
    const { wb, first, ids } = book(2);
    const untouched = wb.sheet(ids[1]).cells;
    wb.transaction('Insert and note', () => { wb.insertRows(first, 0, 1); wb.setInput(ids[0], 5, 0, 'noted'); });
    expect(wb._snapshotCells).toBe(2000 + 20000);
    wb.undo();
    expect(wb.getCell(ids[0], 5, 0).v).toBe(50);
    expect(wb.getCell(first, 0, 0).v).toBe(0);
    expect(wb.sheet(ids[1]).cells).toBe(untouched);
    wb.redo();
    expect(wb.getCell(ids[0], 5, 0).v).toBe('noted');
    expect(wb.getCell(first, 1, 0).v).toBe(0);
    expect(wb.sheet(ids[1]).cells).toBe(untouched);
  }, 60000);
});

describe('a structural step on the sheet list', () => {
  it('brings a deleted sheet back among the others, with the references to it on every sheet', () => {
    const wb = new Workbook();
    const a = wb.sheets[0].id;
    const b = wb.addSheet('Two').id;
    const c = wb.addSheet('Three').id;
    wb.setInput(a, 0, 0, '7');
    wb.setInput(b, 0, 0, '=Sheet1!A1*2');
    wb.setInput(b, 1, 0, 'kept');
    wb.setInput(c, 0, 0, '=Two!A1+1');
    wb.clearHistory();
    const aCells = wb.sheet(a).cells;
    wb.deleteSheet(b);
    expect(wb.sheets.map((s) => s.name)).toEqual(['Sheet1', 'Three']);
    expect(wb.getCell(c, 0, 0).f).toContain('#REF!');
    wb.undo();
    expect(wb.sheets.map((s) => s.name)).toEqual(['Sheet1', 'Two', 'Three']);
    expect(wb.sheet(b).id).toBe(b);
    expect(wb.getCell(c, 0, 0).f).toBe('Two!A1+1');
    expect(wb.getValue(c, 0, 0)).toBe(15);
    expect(wb.getCell(b, 1, 0).v).toBe('kept');
    expect(wb.sheet(a).cells).toBe(aCells); // Sheet1 named no sheet: kept as it was
    wb.redo();
    expect(wb.sheets.map((s) => s.name)).toEqual(['Sheet1', 'Three']);
    expect(wb.getCell(c, 0, 0).f).toContain('#REF!');
  });

  it('restores a sheet a later step rebuilt when an earlier step had kept it as it was', () => {
    const wb = new Workbook();
    const a = wb.sheets[0].id;
    const b = wb.addSheet('Two').id;
    wb.setInput(a, 0, 0, 'a0');
    wb.setInput(b, 0, 0, 'b0');
    wb.clearHistory();
    wb.insertRows(a, 0, 1); // Two is left as it is by this step
    wb.setInput(b, 1, 0, 'b1');
    wb.deleteSheet(b);
    wb.undo(); // Two is back, rebuilt from the deletion's snapshot
    expect(wb.getCell(b, 1, 0).v).toBe('b1');
    wb.undo(); // the edit is taken off the rebuilt sheet
    expect(wb.getCell(b, 1, 0)?.v).toBeUndefined();
    wb.undo(); // the insertion's snapshot names Two by id: the rebuilt sheet, as it now stands
    expect(wb.getCell(a, 0, 0).v).toBe('a0');
    expect(wb.getCell(b, 0, 0).v).toBe('b0');
    expect(wb.getCell(b, 1, 0)?.v).toBeUndefined();
    wb.redo();
    wb.redo();
    wb.redo();
    expect(wb.sheets.map((s) => s.name)).toEqual(['Sheet1']);
    expect(wb.getCell(a, 1, 0).v).toBe('a0');
    wb.undo();
    expect(wb.getCell(b, 1, 0).v).toBe('b1');
  });

  it('renames a sheet and undoes it on the sheets that named it, leaving the rest as they were', () => {
    const wb = new Workbook();
    const a = wb.sheets[0].id;
    const b = wb.addSheet('Two').id;
    const c = wb.addSheet('Three').id;
    wb.setInput(b, 0, 0, '=Sheet1!A1');
    wb.setInput(c, 0, 0, '5');
    wb.clearHistory();
    const cCells = wb.sheet(c).cells;
    wb.renameSheet(a, 'Main');
    expect(wb.getCell(b, 0, 0).f).toBe('Main!A1');
    expect(wb._snapshotCells).toBe(1); // Two's one cell; Sheet1 holds none, and Three is not held at all
    wb.undo();
    expect(wb.sheet(a).name).toBe('Sheet1');
    expect(wb.getCell(b, 0, 0).f).toBe('Sheet1!A1');
    expect(wb.sheet(c).cells).toBe(cCells);
    wb.redo();
    expect(wb.sheet(a).name).toBe('Main');
    expect(wb.getCell(b, 0, 0).f).toBe('Main!A1');
  });

  it('takes a duplicated sheet away and brings it back under the same id', () => {
    const wb = new Workbook();
    const a = wb.sheets[0].id;
    wb.setInput(a, 0, 0, 'x');
    wb.clearHistory();
    const copy = wb.duplicateSheet(a).id;
    wb.undo();
    expect(wb.sheets.map((s) => s.id)).toEqual([a]);
    wb.redo();
    expect(wb.sheets.map((s) => s.id)).toEqual([a, copy]);
    expect(wb.getCell(copy, 0, 0).v).toBe('x');
    expect(wb.activeSheetId).toBe(copy);
  });
});

describe('a structural step that changes a sheet in place', () => {
  it('undoes deleting every row of a sheet, the last row\'s cells included', () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    const last = wb.sheet(id).rows - 1;
    wb.setInput(id, 0, 0, 'top');
    wb.setInput(id, last, 2, 'bottom');
    wb.clearHistory();
    wb.deleteRows(id, 0, last + 1);
    expect(wb.getCell(id, 0, 0)?.v).toBeUndefined();
    expect(wb.sheet(id).cells.size).toBe(0);
    wb.undo();
    expect(wb.getCell(id, 0, 0).v).toBe('top');
    expect(wb.getCell(id, last, 2).v).toBe('bottom');
    wb.redo();
    expect(wb.sheet(id).cells.size).toBe(0);
  });

  it('undoes collapsing a group, whose lines are hidden in place', () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    wb.groupLines(id, 'row', 2, 4);
    wb.clearHistory();
    wb.toggleGroup(id, 'row', 2, 4);
    expect(wb.sheet(id).hiddenRows.has(3)).toBe(true);
    wb.undo();
    expect(wb.sheet(id).hiddenRows.has(3)).toBe(false);
    expect(wb.sheet(id).groups.rows[0].collapsed).toBe(false);
    wb.redo();
    expect(wb.sheet(id).hiddenRows.has(3)).toBe(true);
    expect(wb.sheet(id).groups.rows[0].collapsed).toBe(true);
  });
});
