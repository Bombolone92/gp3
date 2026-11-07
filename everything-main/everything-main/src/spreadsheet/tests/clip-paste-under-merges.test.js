// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';

// A merged cell takes one value, at its top-left: a paste that lands on the
// cells hidden under it must not write there, whatever the paste came from.
function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() };
}
Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true });

describe('pastes over merged cells', () => {
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

  async function mount(clipboard) {
    vi.stubGlobal('navigator', { onLine: true, clipboard });
    const doc = new Doc({ name: 'Merged', path: 'Spreadsheets/Merged.xlsx' });
    const wb = doc.wb;
    const id = wb.activeSheetId;
    wb.mergeCells(id, { r1: 0, c1: 1, r2: 1, c2: 1 }); // B1:B2
    wb.clearHistory();
    view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
    document.querySelector('#app').append(view.el);
    await vi.advanceTimersByTimeAsync(1);
    view.el.querySelector('.grid-viewport').focus();
    view.goTo('Sheet1!B1');
    const menuItem = (label) => [...document.querySelectorAll('.menu-item')].find((b) => b.querySelector('.menu-label')?.textContent === label);
    const pasteSpecial = async (label) => {
      view.el.querySelector('[data-menu="edit"]').click();
      menuItem('Paste special').click();
      menuItem(label).click();
      await vi.advanceTimersByTimeAsync(5);
    };
    return { wb, id, pasteSpecial, column: () => [0, 1, 2].map((r) => wb.getValue(id, r, 1)) };
  }

  const table = (type) => ({ read: async () => [{ types: [type], getType: async () => ({ text: async () => (type === 'text/html'
    ? '<table><tr><td>x</td></tr><tr><td>y</td></tr><tr><td>z</td></tr></table>' : 'x\ny\nz') }) }] });

  it('skips the cells under a merge when a web table is pasted', async () => {
    const { wb, id, pasteSpecial, column } = await mount(table('text/html'));
    view.el.querySelector('[data-menu="edit"]').click();
    [...document.querySelectorAll('.menu-item')].find((b) => b.querySelector('.menu-label')?.textContent === 'Paste').click();
    await vi.advanceTimersByTimeAsync(5);
    expect(column()).toEqual(['x', null, 'z']);
    expect(wb.sheet(id).merges).toEqual([{ r1: 0, c1: 1, r2: 1, c2: 1 }]);
    wb.undo();
    await pasteSpecial('Skip blanks');
    expect(column()).toEqual(['x', null, 'z']);
  });

  it('skips the cells under a merge when plain text is pasted without its blanks', async () => {
    const { pasteSpecial, column } = await mount(table('text/plain'));
    await pasteSpecial('Skip blanks');
    expect(column()).toEqual(['x', null, 'z']);
  });
});
