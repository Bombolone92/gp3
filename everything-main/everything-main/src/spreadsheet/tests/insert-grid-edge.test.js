import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { MAX_ROW, MAX_COL, adjustRefForInsert } from '../src/core/refs.js';

const column = { r1: 0, c1: 1, r2: MAX_ROW, c2: 1 };
function edgeBook() {
  return new Workbook({ sheets: [{ name: 'Sheet1', rows: 100, cols: 26,
    cells: { '0,1': { v: 5 }, '0,3': { f: 'SUM(B1:B1048576)' }, '0,4': { f: 'B1048576' }, '0,5': { f: 'SUM(A1:XFD1)' } },
    rules: [{ type: 'gt', value: 3, range: { ...column }, style: { bg: '#ffff00' } }],
    validations: [{ type: 'number', range: { ...column } }],
    protectedRanges: [{ range: { ...column } }],
    charts: [{ type: 'column', range: { ...column }, anchor: { r: 0, c: 7 } }] }] });
}
const counts = (wb) => { const s = wb.sheets[0]; return [s.rules.length, s.validations.length, s.protectedRanges.length, s.charts.length]; };

describe('inserting lines next to the grid edge', () => {
  it('keeps whole-column ranges anchored at the last row instead of pushing them off the grid', () => {
    const wb = edgeBook();
    const id = wb.activeSheetId;
    wb.insertRows(id, 0, 1);
    const s = wb.sheets[0];
    for (const range of [s.rules[0].range, s.validations[0].range, s.protectedRanges[0].range, s.charts[0].range]) expect(range).toEqual({ r1: 1, c1: 1, r2: MAX_ROW, c2: 1 });
    // The stored ranges survive a save and reload, and a structural undo/redo, which reload the workbook.
    expect(counts(new Workbook(JSON.parse(JSON.stringify(wb.toJSON()))))).toEqual([1, 1, 1, 1]);
    wb.undo();
    wb.redo();
    expect(counts(wb)).toEqual([1, 1, 1, 1]);
    expect(wb.lockedAt(id, 5000, 1)).toBeTruthy();
  });

  it('rewrites references that reach the last row or column', () => {
    const wb = edgeBook();
    const id = wb.activeSheetId;
    wb.insertRows(id, 0, 1);
    expect(wb.getCell(id, 1, 3).f).toBe('SUM(B2:B1048576)');
    expect(wb.getValue(id, 1, 3)).toBe(5);
    expect(wb.getCell(id, 1, 4).f).toBe('#REF!');
    expect(wb.getValue(id, 1, 4)).toEqual({ error: '#REF!' });
    wb.insertCols(id, 0, 2);
    expect(wb.getCell(id, 1, 7).f).toBe('SUM(C2:XFD2)');
    expect(adjustRefForInsert({ kind: 'cell', r1: MAX_ROW, c1: 0, r2: MAX_ROW, c2: 0 }, 'row', 0, 1)).toBeNull();
    expect(adjustRefForInsert({ kind: 'range', r1: 0, c1: 0, r2: MAX_ROW, c2: 0 }, 'row', 0, 3)).toMatchObject({ r1: 3, r2: MAX_ROW });
    expect(adjustRefForInsert({ kind: 'range', r1: 0, c1: MAX_COL - 1, r2: 0, c2: MAX_COL }, 'col', 0, 1)).toMatchObject({ c1: MAX_COL, c2: MAX_COL });
  });

  it('refuses an insertion that would push cells, notes, merges or charts off the sheet', () => {
    // A cell at the file format's last row or column comes only from a file, whose sheet has room for it; typing past the grid is refused.
    const wb = new Workbook({ sheets: [{ name: 'Sheet1', rows: MAX_ROW + 1 }] });
    const id = wb.activeSheetId;
    wb.setInput(id, MAX_ROW, 0, 'edge');
    expect(wb.insertRows(id, 0, 1)).toBe(false);
    expect([...wb.sheets[0].cells.keys()]).toEqual([`${MAX_ROW},0`]);
    expect(wb.canUndo?.() ?? wb._history.length === 0).toBeTruthy();
    wb.setInput(id, MAX_ROW, 0, '');
    wb.setNote(id, MAX_ROW - 1, 0, 'last note');
    expect(wb.insertRows(id, 0, 2)).toBe(false);
    expect(wb.insertRows(id, 0, 1)).toBe(true);
    expect(wb.getNote(id, MAX_ROW, 0)).toBe('last note');
    const wc = new Workbook({ sheets: [{ name: 'Sheet1', cols: MAX_COL + 1 }] });
    const cid = wc.activeSheetId;
    wc.setInput(cid, 0, MAX_COL, 'x');
    expect(wc.insertCols(cid, 0, 1)).toBe(false);
    expect(wc.insertCols(cid, MAX_COL + 1, 1)).toBe(false);
    expect(wc.getValue(cid, 0, MAX_COL)).toBe('x');
  });
});
