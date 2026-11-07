// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { openNamesManager } from '../src/ui/names.js';
import { closeAllModals } from '../src/ui/modal.js';

vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  document.body.innerHTML = '<div id="app"></div>';
});
afterEach(() => { closeAllModals(); vi.runAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

// A reference to a sheet that does not exist parsed fine, was saved, and every formula using the name showed #REF!.
describe('a defined name referring to an unknown sheet', () => {
  it('is refused by defineName with the sheet named', () => {
    const wb = new Workbook({ sheets: [{ name: 'One' }, { name: 'Two Data' }] });
    expect(wb.defineName('Bad', 'Nope!$A$1')).toBe('There is no sheet called Nope');
    expect(wb.defineName('Bad', "'No Such'!$A$1:$B$2")).toBe('There is no sheet called No Such');
    expect(wb.defineName('Bad', 'One:Nope!$A$1')).toBe('There is no sheet called Nope');
    expect(wb.names).toEqual([]);
    expect(wb.canUndo()).toBe(false);
    // The sheet's spelling is not case sensitive, and quoted names still work.
    expect(wb.defineName('First', 'one!$A$1')).toBeNull();
    expect(wb.defineName('Second', "'Two Data'!$A$1:$B$2")).toBeNull();
    expect(wb.defineName('Third', "'One:Two Data'!$A$1")).toBeNull();
    expect(wb.defineName('Formula', 'LAMBDA(x, x*2)')).toBeNull();
  });

  it('is refused when renaming too', () => {
    const wb = new Workbook({ sheets: [{ name: 'One' }], names: [{ name: 'Old', ref: 'One!$A$1' }] });
    expect(wb.renameName('Old', null, 'New', 'Gone!$A$1')).toBe('There is no sheet called Gone');
    expect(wb.names.map((n) => n.name)).toEqual(['Old']);
  });

  it('shows the error in the names manager instead of saving', () => {
    const wb = new Workbook({ sheets: [{ name: 'One' }] });
    openNamesManager({ wb, sheetId: () => wb.activeSheetId, grid: { range: { r1: 0, c1: 0, r2: 0, c2: 0 } }, run: vi.fn() });
  document.querySelector('[aria-label="New name"]').click();
    document.querySelector('.modal-root [aria-label="Name"]').value = 'Sales';
    document.querySelector('.modal-root [aria-label="Refers to"]').value = 'Nope!$A$1';
    document.querySelector('.modal-root form').requestSubmit();
    const error = document.querySelector('.modal-root .field-error');
    expect(error.hidden).toBe(false);
    expect(error.textContent).toBe('There is no sheet called Nope');
    expect(wb.names).toEqual([]);
  });
});
