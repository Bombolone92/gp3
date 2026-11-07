// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';

// A cut cleared its cells at once and the paste placed them later, so the
// move took two undo steps: one Undo left both places empty. A cut now
// leaves the cells where they are until the paste moves them, in one step,
// and a cut that is never pasted changes nothing.
function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() };
}
Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true });

describe('placeMoved', () => {
  it('clears the cut block itself, in the same step as the landing', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, '10');
    wb.setInput(id, 1, 0, '=A1+1');
    wb.setInput(id, 0, 1, '=A1*2');
    wb.clearHistory();
    const src = { r1: 0, c1: 0, r2: 1, c2: 0 };
    const cells = wb.copyRange(id, src);
    expect(wb.placeMoved(id, 4, 2, cells, { sheetId: id, range: src })).toEqual({ r1: 4, c1: 2, r2: 5, c2: 2 });
    expect(wb.getCell(id, 0, 0)).toBeFalsy();
    expect(wb.getCell(id, 1, 0)).toBeFalsy();
    expect(wb.getCell(id, 5, 2).f).toBe('C5+1');
    expect(wb.getCell(id, 0, 1).f).toBe('C5*2');
    expect(wb.undoLabels()).toEqual(['Move cells']);
    wb.undo();
    expect(wb.getValue(id, 0, 0)).toBe(10);
    expect(wb.getCell(id, 1, 0).f).toBe('A1+1');
    expect(wb.getCell(id, 0, 1).f).toBe('A1*2');
    expect(wb.getCell(id, 4, 2)).toBeFalsy();
    // Across sheets the source sheet is cleared too.
    const other = wb.addSheet('Two').id;
    expect(wb.placeMoved(other, 0, 0, cells, { sheetId: id, range: src })).toBeTruthy();
    expect(wb.getCell(id, 0, 0)).toBeFalsy();
    expect(wb.getValue(other, 0, 0)).toBe(10);
    expect(wb.getCell(id, 0, 1).f).toBe('Two!A1*2');
  });

  it('moves a block over itself without losing cells', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    for (let r = 0; r < 3; r++) wb.setInput(id, r, 0, String(r + 1));
    const src = { r1: 0, c1: 0, r2: 2, c2: 0 };
    wb.placeMoved(id, 1, 0, wb.copyRange(id, src), { sheetId: id, range: src });
    expect(wb.rangeValues(id, { r1: 0, c1: 0, r2: 3, c2: 0 })).toEqual([[null], [1], [2], [3]]);
  });
});

describe('cut and paste in the editor', () => {
  let view;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
    vi.stubGlobal('requestAnimationFrame', (fn) => setTimeout(fn, 0));
    vi.stubGlobal('cancelAnimationFrame', clearTimeout);
    Element.prototype.scrollIntoView = () => {};
    Element.prototype.scrollTo = () => {};
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 400 });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ measureText: (t) => ({ width: t.length * 7 }), font: '' });
    document.body.innerHTML = '<div id="app"></div>';
  });
  afterEach(() => { view?.destroy(); view = null; vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

  async function mount(prep) {
    const doc = new Doc({ name: 'Cut', path: 'Spreadsheets/Cut.xlsx' });
    const wb = doc.wb;
    const id = wb.activeSheetId;
    prep(wb, id);
    wb.clearHistory();
    view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
    document.querySelector('#app').append(view.el);
    await vi.advanceTimersByTimeAsync(1);
    const viewport = view.el.querySelector('.grid-viewport');
    viewport.focus();
    const clipboardEvent = (type) => {
      const e = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(e, 'clipboardData', { value: { getData: () => '', setData() {}, files: [] } });
      return e;
    };
    const cut = (where) => { view.goTo(`Sheet1!${where}`); viewport.dispatchEvent(clipboardEvent('cut')); };
    const paste = (where) => { view.goTo(`Sheet1!${where}`); viewport.dispatchEvent(clipboardEvent('paste')); };
    return { wb, id, viewport, cut, paste, clipboardEvent };
  }

  it('leaves the cells in place until the paste moves them, in one undo step', async () => {
    const { wb, id, cut, paste } = await mount((wb, id) => { wb.setInput(id, 0, 0, '5'); wb.setInput(id, 0, 1, '=A1*2'); wb.setInput(id, 0, 2, '=B1'); });
    cut('B1');
    expect(wb.getCell(id, 0, 1).f).toBe('A1*2');
    expect(wb.canUndo()).toBe(false);
    paste('B3');
    expect(wb.getCell(id, 0, 1)).toBeFalsy();
    expect(wb.getCell(id, 2, 1).f).toBe('A1*2');
    expect(wb.getCell(id, 0, 2).f).toBe('B3');
    expect(wb.getValue(id, 0, 2)).toBe(10);
    expect(wb.undoLabels()).toHaveLength(1);
    wb.undo();
    expect(wb.getCell(id, 0, 1).f).toBe('A1*2');
    expect(wb.getCell(id, 2, 1)).toBeFalsy();
    expect(wb.getCell(id, 0, 2).f).toBe('B1');
    wb.redo();
    expect(wb.getCell(id, 0, 1)).toBeFalsy();
    expect(wb.getCell(id, 2, 1).f).toBe('A1*2');
    // The second paste of the same clip is a copy.
    paste('B5');
    expect(wb.getCell(id, 4, 1).f).toBe('A5*2');
    expect(wb.getCell(id, 2, 1).f).toBe('A1*2');
  });

  it('is cancelled by Escape, by another copy, and by a change to the cut cells', async () => {
    const { wb, id, viewport, cut, paste, clipboardEvent } = await mount((wb, id) => { wb.setInput(id, 0, 0, '5'); wb.setInput(id, 1, 0, '6'); });
    cut('A1');
    viewport.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    paste('D1');
    expect(wb.getValue(id, 0, 0)).toBe(5);
    expect(wb.getValue(id, 0, 3)).toBe(5);

    cut('A1');
    view.goTo('Sheet1!A2');
    viewport.dispatchEvent(clipboardEvent('copy'));
    paste('D2');
    expect(wb.getValue(id, 0, 0)).toBe(5);
    expect(wb.getValue(id, 1, 0)).toBe(6);
    expect(wb.getValue(id, 1, 3)).toBe(6);

    cut('A1');
    wb.setInput(id, 0, 0, '7');
    paste('D3');
    expect(wb.getValue(id, 0, 0)).toBe(7);
    expect(wb.getValue(id, 2, 3)).toBe(5);
  });

  it('is cancelled by any other change to the workbook, or by starting to edit a cell, but not by moving to another sheet', async () => {
    const { wb, id, viewport, cut, paste, clipboardEvent } = await mount((wb, id) => { wb.setInput(id, 0, 0, '5'); wb.addSheet('Two'); });
    cut('A1');
    wb.setInput(id, 5, 5, 'elsewhere');
    paste('D1');
    expect(wb.getValue(id, 0, 0)).toBe(5);
    expect(wb.getValue(id, 0, 3)).toBe(5);

    cut('A1');
    view.goTo('Sheet1!C3');
    viewport.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true, cancelable: true }));
    await vi.advanceTimersByTimeAsync(1);
    view.el.querySelector('.grid-editor').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(wb.getCell(id, 2, 2)).toBeFalsy();
    paste('D2');
    expect(wb.getValue(id, 0, 0)).toBe(5);
    expect(wb.getValue(id, 1, 3)).toBe(5);

    cut('A1');
    view.goTo('Two!B2');
    expect(wb.getValue(id, 0, 0)).toBe(5);
    const two = wb.sheetByName('Two').id;
    viewport.dispatchEvent(clipboardEvent('paste'));
    expect(wb.getCell(id, 0, 0)).toBeFalsy();
    expect(wb.getValue(two, 1, 1)).toBe(5);
    expect(wb.undoLabels()[0]).toBe('Move cells');
  });

  it('ends the cut when a paste special copies the cut cells, so a later paste does not move them', async () => {
    const { wb, id, cut, paste } = await mount((wb, id) => { wb.setInput(id, 0, 0, '5'); wb.setInput(id, 1, 0, '6'); wb.setInput(id, 0, 1, '=A1*2'); });
    cut('A1:A2');
    view.goTo('Sheet1!C1');
    view.el.querySelector('[data-menu="edit"]').click();
    const item = (label) => [...document.querySelectorAll('.menu-item')].find((b) => b.querySelector('.menu-label')?.textContent === label);
    item('Paste special').click(); item('Transposed').click();
    await vi.advanceTimersByTimeAsync(5);
    // The transposed paste is a copy: the cut cells stay.
    expect(wb.rangeValues(id, { r1: 0, c1: 2, r2: 0, c2: 3 })).toEqual([[5, 6]]);
    expect(wb.getValue(id, 0, 0)).toBe(5);
    paste('H1');
    expect(wb.getValue(id, 0, 0)).toBe(5);
    expect(wb.getValue(id, 0, 7)).toBe(5);
    expect(wb.getCell(id, 0, 1).f).toBe('A1*2');
  });

  it('moves the visible cells of a filtered cut and leaves the hidden ones', async () => {
    const { wb, id, cut, paste } = await mount((wb, id) => {
      for (let r = 0; r < 3; r++) wb.setInput(id, r, 0, String(r + 1));
      wb.setHidden(id, 'row', [1], true);
    });
    cut('A1:A3');
    expect(wb.rangeValues(id, { r1: 0, c1: 0, r2: 2, c2: 0 })).toEqual([[1], [2], [3]]);
    paste('C1');
    expect(wb.rangeValues(id, { r1: 0, c1: 0, r2: 2, c2: 0 })).toEqual([[null], [2], [null]]);
    expect(wb.rangeValues(id, { r1: 0, c1: 2, r2: 1, c2: 2 })).toEqual([[1], [3]]);
    expect(wb.undoLabels()).toHaveLength(1);
    wb.undo();
    expect(wb.rangeValues(id, { r1: 0, c1: 0, r2: 2, c2: 0 })).toEqual([[1], [2], [3]]);
    expect(wb.getCell(id, 0, 2)).toBeFalsy();
  });

  it('copies a filtered partial fixed array without clearing its source or notes', async () => {
    const { wb, id, cut, paste } = await mount((wb, id) => {
      wb.setArrayFormula(id, { r1: 0, c1: 0, r2: 2, c2: 1 }, '=ROW()+COLUMN()');
      wb.setNote(id, 0, 0, 'Keep at source');
      wb.setHidden(id, 'row', [1], true);
    });
    cut('A1:B3');
    paste('D1');
    expect(wb.getCell(id, 0, 0).array).toEqual({ rows: 3, cols: 2 });
    expect(wb.getNote(id, 0, 0)).toBe('Keep at source');
    expect(wb.rangeValues(id, { r1: 0, c1: 3, r2: 1, c2: 4 })).toEqual([[2, 3], [4, 5]]);
  });

  it('refuses a filtered cut into part of another fixed array before clearing anything', async () => {
    const { wb, id, cut, paste } = await mount((wb, id) => {
      for (let r = 0; r < 3; r++) wb.setInput(id, r, 0, String(r + 1));
      wb.setNote(id, 0, 0, 'Keep at source');
      wb.setArrayFormula(id, { r1: 0, c1: 3, r2: 2, c2: 4 }, '=5');
      wb.setHidden(id, 'row', [1], true);
    });
    view.goTo('Sheet1!D1');
    const before = wb.toJSON();
    cut('A1:A3');
    paste('D1');
    expect(wb.toJSON()).toEqual(before);
    expect(wb.canUndo()).toBe(false);
  });
  it('moves only visible native sparkline anchors in one undo step', async () => {
    const { wb, id, cut, paste } = await mount((wb, id) => {
      wb.sheet(id).sparklineGroups = new Workbook({ sheets: [{ name: 'Sheet1', sparklineGroups: [{ sparklines: [
        { ref: 'D1', formula: 'A1:B1' }, { ref: 'D2', formula: 'A2:B2' }, { ref: 'D3', formula: 'A3:B3' },
      ] }] }] }).activeSheet.sparklineGroups;
      wb.setHidden(id, 'row', [1], true);
    });
    const before = structuredClone(wb.sheet(id).sparklineGroups);
    cut('D1:D3'); paste('F5');
    expect(wb.sheet(id).sparklineGroups[0].sparklines).toEqual([
      { ref: 'D2', formula: 'A2:B2' }, { ref: 'F5', formula: 'A1:B1' }, { ref: 'F6', formula: 'A3:B3' },
    ]);
    expect(wb.undoLabels()).toHaveLength(1);
    const after = structuredClone(wb.sheet(id).sparklineGroups);
    wb.undo(); expect(wb.sheet(id).sparklineGroups).toEqual(before);
    wb.redo(); expect(wb.sheet(id).sparklineGroups).toEqual(after);
  });

  it('refuses a filtered cut that would discard off-grid source cells or native charts', async () => {
    const { wb, id, cut, paste } = await mount((wb, id) => {
      for (let r = 0; r < 3; r++) wb.setInput(id, r, 0, String(r + 1));
      wb.sheet(id).sparklineGroups = new Workbook({ sheets: [{ sparklineGroups: [{ sparklines: [{ ref: 'A3', formula: 'C3:D3' }] }] }] }).activeSheet.sparklineGroups;
      wb.setHidden(id, 'row', [1], true);
    });
    view.goTo('Sheet1!C1048576'); wb.clearHistory();
    cut('A1:A3'); paste('C1048576');
    expect(wb.rangeValues(id, { r1: 0, r2: 2, c1: 0, c2: 0 })).toEqual([[1], [2], [3]]);
    expect(wb.getValue(id, 1048575, 2)).toBeNull();
    expect(wb.sheet(id).sparklineGroups[0].sparklines).toEqual([{ ref: 'A3', formula: 'C3:D3' }]);
    expect(wb.canUndo()).toBe(false);
  });

  it('preserves filtered moved formulas and follows dependent cells and defined names', async () => {
    const { wb, id, cut, paste } = await mount((wb, id) => {
      for (let r = 0; r < 3; r++) { wb.setInput(id, r, 0, String((r + 1) * 10)); wb.setInput(id, r, 1, `=A${r + 1}+1`); }
      wb.setInput(id, 0, 7, '=B1+$B$3');
      expect(wb.defineName('MovedValue', 'Sheet1!B3')).toBeNull();
      wb.setHidden(id, 'row', [1], true);
    });
    const state = () => { const json = wb.toJSON(); for (const sheet of json.sheets) delete sheet.viewSelection; return json; };
    const before = state(); cut('B1:B3'); paste('F5');
    expect(wb.getCell(id, 4, 5).f).toBe('A1+1'); expect(wb.getCell(id, 5, 5).f).toBe('A3+1');
    expect(wb.getValue(id, 4, 5)).toBe(11); expect(wb.getValue(id, 5, 5)).toBe(31);
    expect(wb.getCell(id, 1, 1).f).toBe('A2+1'); expect(wb.getCell(id, 0, 7).f).toBe('F5+$F$6');
    expect(wb.namedEntry('MovedValue').ref).toBe('Sheet1!F6');
    const after = state(); wb.undo(); expect(state()).toEqual(before); wb.redo(); expect(state()).toEqual(after);
  });

  it('carries cross-sheet packed formulas with both moved and retained inputs', async () => {
    const { wb, id, cut, viewport, clipboardEvent } = await mount((wb, id) => {
      wb.addSheet('Two'); wb.activeSheetId = id;
      wb.setInput(id, 0, 0, '10'); wb.setInput(id, 2, 0, '30'); wb.setInput(id, 0, 2, '2');
      wb.setInput(id, 0, 1, '=A1+$C$1'); wb.setInput(id, 2, 1, '=A3+$C$1'); wb.setInput(id, 0, 7, '=B1+B3');
      wb.setHidden(id, 'row', [1], true);
    });
    cut('A1:B3'); view.goTo('Two!E5'); viewport.dispatchEvent(clipboardEvent('paste'));
    const target = wb.sheetByName('Two').id;
    expect(wb.getCell(target, 4, 5).f).toBe('E5+Sheet1!$C$1');
    expect(wb.getCell(target, 5, 5).f).toBe('E6+Sheet1!$C$1');
    expect(wb.getValue(target, 4, 5)).toBe(12); expect(wb.getValue(target, 5, 5)).toBe(32);
    expect(wb.getCell(id, 0, 7).f).toBe('Two!F5+Two!F6');
  });

  it('updates overlapping packed references once and leaves a range spanning hidden cells intact', async () => {
    const { wb, id, cut, paste } = await mount((wb, id) => {
      wb.setInput(id, 0, 0, '=A3+1'); wb.setInput(id, 2, 0, '3');
      wb.setInput(id, 0, 2, '=A1+A3'); wb.setInput(id, 0, 3, '=SUM(A1:A3)');
      wb.setHidden(id, 'row', [1], true);
    });
    cut('A1:A3'); paste('A3');
    expect(wb.getCell(id, 2, 0).f).toBe('A4+1'); expect(wb.getValue(id, 2, 0)).toBe(4);
    expect(wb.getCell(id, 0, 2).f).toBe('A3+A4'); expect(wb.getCell(id, 0, 3).f).toBe('SUM(A1:A3)');
  });

  it('retains source-scoped names across sheets without capturing LET variables', async () => {
    const { wb, id, cut, viewport, clipboardEvent } = await mount((wb, id) => {
      const target = wb.addSheet('Two').id; wb.activeSheetId = id;
      wb.setInput(id, 0, 2, '2'); wb.setInput(target, 0, 2, '100');
      expect(wb.defineName('Tax', 'Sheet1!$C$1', 'Sheet1')).toBeNull();
      expect(wb.defineName('Tax', 'Two!$C$1', 'Two')).toBeNull();
      wb.setInput(id, 0, 1, '=Tax+LET(Tax,3,Tax)'); wb.setInput(id, 2, 1, '=Tax');
      wb.setHidden(id, 'row', [1], true);
    });
    cut('B1:B3'); view.goTo('Two!F5'); viewport.dispatchEvent(clipboardEvent('paste'));
    const target = wb.sheetByName('Two').id;
    expect(wb.getCell(target, 4, 5).f).toBe('Sheet1!Tax+LET(Tax,3,Tax)');
    expect(wb.getValue(target, 4, 5)).toBe(5); expect(wb.getValue(target, 5, 5)).toBe(2);
  });

  it.each([false, true])('handles destination merges atomically for blank native anchors (partial=%s)', async partial => {
    const { wb, id, cut, paste } = await mount((wb, id) => {
      wb.sheet(id).sparklineGroups = new Workbook({ sheets: [{ sparklineGroups: [{ sparklines: [
        { ref: 'D1', formula: 'A1:B1' }, { ref: 'D3', formula: 'A3:B3' },
      ] }] }] }).activeSheet.sparklineGroups;
      wb.setHidden(id, 'row', [1], true);
      wb.mergeCells(id, partial ? { r1: 5, r2: 5, c1: 5, c2: 6 } : { r1: 4, r2: 5, c1: 5, c2: 5 });
    });
    const before = structuredClone(wb.sheet(id).sparklineGroups), merges = structuredClone(wb.sheet(id).merges);
    cut('D1:D3'); paste('F5');
    if (partial) {
      expect(wb.sheet(id).sparklineGroups).toEqual(before); expect(wb.sheet(id).merges).toEqual(merges); expect(wb.canUndo()).toBe(false);
    } else {
      expect(wb.sheet(id).sparklineGroups[0].sparklines).toEqual([{ ref: 'F5', formula: 'A1:B1' }, { ref: 'F6', formula: 'A3:B3' }]);
      expect(wb.sheet(id).merges).toEqual([]); wb.undo();
      expect(wb.sheet(id).sparklineGroups).toEqual(before); expect(wb.sheet(id).merges).toEqual(merges);
    }
  });

  it('replaces fully covered merges on another sheet during a packed cut', async () => {
    const { wb, id, cut, viewport, clipboardEvent } = await mount((wb, id) => {
      const target = wb.addSheet('Two').id; wb.activeSheetId = id;
      wb.setInput(id, 0, 0, 'One'); wb.setInput(id, 2, 0, 'Three'); wb.setHidden(id, 'row', [1], true);
      wb.mergeCells(target, { r1: 4, r2: 5, c1: 3, c2: 3 });
    });
    cut('A1:A3'); view.goTo('Two!D5'); viewport.dispatchEvent(clipboardEvent('paste'));
    const target = wb.sheetByName('Two'); expect(target.merges).toEqual([]);
    expect(wb.getValue(target.id, 4, 3)).toBe('One'); expect(wb.getValue(target.id, 5, 3)).toBe('Three');
    wb.undo(); expect(target.merges).toEqual([{ r1: 4, r2: 5, c1: 3, c2: 3 }]);
    expect(wb.getValue(id, 0, 0)).toBe('One'); expect(wb.getValue(id, 2, 0)).toBe('Three');
  });

});
