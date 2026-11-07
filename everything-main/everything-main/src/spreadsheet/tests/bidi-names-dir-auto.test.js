// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGrid } from '../src/ui/grid.js';
import { createFormulaBar } from '../src/ui/formulabar.js';
import { createSheetTabs } from '../src/ui/sheettabs.js';
import { promptDialog, closeAllModals } from '../src/ui/modal.js';
import { closeMenu } from '../src/ui/menu.js';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { Workbook } from '../src/core/workbook.js';

// A cell and the in-cell editor follow their text's direction, so a Hebrew or Arabic name reads with its
// number and full stop at its own end; the fields and labels that name things did not: the prompt of
// Rename sheet and Rename spreadsheet, the formula bar and name box, the sheet tab and the document title
// laid "גיליון 2." out with the 2 and the full stop at the wrong end.
function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() };
}
Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true });

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
afterEach(() => { closeMenu(); closeAllModals(); view?.destroy(); view = null; vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

describe('fields and labels that carry a name follow the name\'s own direction', () => {
  it('the prompt dialog\'s field', () => {
    promptDialog({ title: 'Rename sheet', label: 'Sheet name', value: 'גיליון 2' });
    const input = document.querySelector('.modal-root input');
    expect(input.value).toBe('גיליון 2');
    expect(input.getAttribute('dir')).toBe('auto');
  });

  it('the formula bar and the name box', () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    const grid = createGrid({ wb, sheetId: id, announce() {}, onCommand() {}, onSelection() {}, onEdit() {} });
    const bar = createFormulaBar({
      wb, grid, run() {}, announce() {}, goToName: () => false,
      sheetId: () => grid.sheetId, range: () => grid.range, ranges: () => grid.ranges,
      activeCell: () => wb.getCell(grid.sheetId, grid.active.r, grid.active.c), subscribe: () => () => {},
    });
    document.body.append(grid.el, bar.el);
    expect(bar.el.querySelector('.formula-input').getAttribute('dir')).toBe('auto');
    expect(bar.el.querySelector('.name-box').getAttribute('dir')).toBe('auto');
    bar.destroy?.();
    grid.destroy();
  });

  it('the sheet tab', () => {
    const wb = new Workbook({ sheets: [{ name: 'גיליון 2' }, { name: 'Data' }] });
    const tabs = createSheetTabs({ wb });
    document.body.append(tabs.el);
    for (const name of tabs.el.querySelectorAll('.tab-name')) expect(name.getAttribute('dir')).toBe('auto');
    expect(tabs.el.querySelector('.tab-name').textContent).toBe('גיליון 2');
    tabs.destroy();
  });

  it('the document title', async () => {
    const doc = new Doc({ name: 'תקציב 2026', path: 'Spreadsheets/תקציב 2026.xlsx' });
    view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
    document.querySelector('#app').append(view.el);
    await vi.advanceTimersByTimeAsync(1);
    const title = view.el.querySelector('.doc-title');
    expect(title.textContent).toBe('תקציב 2026');
    expect(title.getAttribute('dir')).toBe('auto');
  });
});
