import { describe, expect, it } from 'vitest';
import { DEFAULT_ROW_HEIGHT, Workbook } from '../src/core/workbook.js';

/** The change events fired while `fn` runs, as [type, sheetId] in order. */
function events(wb, fn) {
  const seen = [];
  const on = (e) => seen.push([e.detail.type, e.detail.sheetId ?? null]);
  wb.addEventListener('change', on);
  try { fn(); } finally { wb.removeEventListener('change', on); }
  return seen;
}

const types = (list) => list.map(([type]) => type);

// Every listener redraws on every change event: the grid rebuilds its row offsets for each layout event,
// so fitting 20,000 rows in one step froze the tab for ten seconds, and undoing it for seven.
describe('one transaction, one change event per kind', () => {
  it('announces a step that sizes thousands of rows once, and its undo and redo once', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.ensureSize(id, 2100, 5);
    const fit = events(wb, () => wb.transaction('Fit row height', () => { for (let r = 0; r < 2000; r++) wb.setRowHeight(id, r, 40); }));
    expect(fit).toEqual([['layout', id], ['history', null]]);
    expect(wb.rowHeight(id, 1999)).toBe(40);
    expect(wb.undoLabel()).toBe('Fit row height');

    const undo = events(wb, () => wb.undo());
    expect(undo).toEqual([['layout', id], ['history', null]]);
    expect(wb.rowHeight(id, 0)).toBe(DEFAULT_ROW_HEIGHT);
    expect(wb.rowHeight(id, 1999)).toBe(DEFAULT_ROW_HEIGHT);

    const redo = events(wb, () => wb.redo());
    expect(redo).toEqual([['layout', id], ['history', null]]);
    expect(wb.rowHeight(id, 0)).toBe(40);
  });

  it('announces a sort carrying notes once for its cells, with the notes already in place', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    const n = 300;
    const entries = [];
    for (let r = 0; r < n; r++) entries.push({ r, c: 0, cell: { v: n - r, f: null } }, { r, c: 1, cell: { v: `row ${r}`, f: null } });
    wb.setCells(id, entries, 'fill');
    for (let r = 0; r < n; r++) wb.setNote(id, r, 1, `note ${r}`);
    wb.clearHistory();
    let noteSeen = null;
    const on = (e) => { if (e.detail.type === 'cells') noteSeen = wb.getNote(id, 0, 1); };
    wb.addEventListener('change', on);
    const sort = events(wb, () => wb.sortRangeBy(id, { r1: 0, c1: 0, r2: n - 1, c2: 1 }, [{ col: 0 }]));
    wb.removeEventListener('change', on);
    expect(types(sort)).toEqual(['cells', 'history']);
    // The listener saw the finished sort: the last row's note had arrived at the top with its row.
    expect(noteSeen).toBe(`note ${n - 1}`);
    expect(wb.getValue(id, 0, 0)).toBe(1);
    expect(wb.getNote(id, n - 1, 1)).toBe('note 0');
    expect(types(events(wb, () => wb.undo()))).toEqual(['cells', 'history']);
    expect(wb.getNote(id, 0, 1)).toBe('note 0');
  });

  it('keeps one event per kind and sheet, in the order the kinds first changed', () => {
    const wb = new Workbook();
    const a = wb.activeSheetId;
    const b = wb.addSheet('Two').id;
    const seen = events(wb, () => wb.transaction('Mixed', () => {
      wb.setRowHeight(a, 0, 40);
      wb.setInput(a, 0, 0, '1');
      wb.setInput(b, 0, 0, '2');
      wb.setColWidth(a, 0, 150);
      wb.transaction('Nested', () => wb.setInput(a, 1, 0, '3')); // folds into the outer step, announcements included
    }));
    expect(seen).toEqual([['layout', a], ['cells', a], ['cells', b], ['history', null]]);
    expect(wb.undoLabel()).toBe('Mixed');
  });

  it('announces a structural step inside a transaction once, and leaves a lone edit as it was', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, 'x');
    const grouped = events(wb, () => wb.transaction('Insert rows', () => { wb.insertRows(id, 0, 1); wb.insertRows(id, 0, 1); wb.setInput(id, 0, 0, 'top'); }));
    expect(types(grouped)).toEqual(['structure', 'cells', 'history']);
    expect(wb.getValue(id, 2, 0)).toBe('x');
    expect(types(events(wb, () => wb.undo()))).toEqual(['structure', 'history']);
    expect(wb.getValue(id, 0, 0)).toBe('x');
    // Outside a transaction nothing changes: an edit announces itself and its step.
    expect(events(wb, () => wb.setRowHeight(id, 3, 50))).toEqual([['layout', id], ['history', null]]);
    expect(events(wb, () => wb.setInput(id, 5, 0, 'y'))).toEqual([['cells', id], ['history', null]]);
  });

  it('lets a listener answer a batch with an edit that joins the step and is announced', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    let answered = false;
    const on = (e) => { if (e.detail.type === 'layout' && !answered) { answered = true; wb.setInput(id, 0, 0, 'from listener'); } };
    wb.addEventListener('change', on);
    const seen = events(wb, () => wb.transaction('Resize rows', () => { wb.setRowHeight(id, 0, 40); wb.setRowHeight(id, 1, 40); }));
    wb.removeEventListener('change', on);
    expect(types(seen)).toEqual(['layout', 'cells', 'history']);
    expect(wb.undoLabel()).toBe('Resize rows');
    wb.undo();
    expect(wb.getValue(id, 0, 0)).toBeNull();
    expect(wb.rowHeight(id, 1)).toBe(DEFAULT_ROW_HEIGHT);
  });

  it('still announces every change when the transaction throws', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    const seen = [];
    wb.addEventListener('change', (e) => seen.push(e.detail.type));
    expect(() => wb.transaction('Broken', () => { wb.setInput(id, 0, 0, '1'); throw new Error('stop'); })).toThrow('stop');
    expect(seen).toEqual(['cells', 'history']);
    expect(wb.getValue(id, 0, 0)).toBe(1);
  });
});
