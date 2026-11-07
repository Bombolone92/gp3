// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { setLocale } from '../src/core/format.js';

// Paste special over content from another app: "Formulas only (keep
// formatting)" keeps the destination's formatting rather than the table's,
// and the arithmetic pastes read the numbers in the app's locale.
function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() };
}
Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true });

describe('paste special from another app', () => {
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
  afterEach(() => { setLocale('en-US'); view?.destroy(); view = null; vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

  async function mount(clipboard, prep) {
    vi.stubGlobal('navigator', { onLine: true, clipboard });
    const doc = new Doc({ name: 'Special', path: 'Spreadsheets/Special.xlsx' });
    const wb = doc.wb;
    const id = wb.activeSheetId;
    prep(wb, id);
    wb.clearHistory();
    view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
    document.querySelector('#app').append(view.el);
    await vi.advanceTimersByTimeAsync(1);
    view.el.querySelector('.grid-viewport').focus();
    const menuItem = (label) => [...document.querySelectorAll('.menu-item')].find((b) => b.querySelector('.menu-label')?.textContent === label);
    const pasteSpecial = async (where, label) => {
      view.goTo(`Sheet1!${where}`);
      view.el.querySelector('[data-menu="edit"]').click();
      menuItem('Paste special').click();
      menuItem(label).click();
      await vi.advanceTimersByTimeAsync(5);
    };
    return { wb, id, pasteSpecial };
  }

  const htmlClipboard = (html) => ({ read: async () => [{ types: ['text/html'], getType: async () => ({ text: async () => html }) }] });

  it('keeps the destination formatting when a web table is pasted as formulas only', async () => {
    const html = '<table><tr><td style="font-weight:bold;color:#ff0000;background:#ffff00">12</td><td>=A1*2</td></tr></table>';
    const { wb, id, pasteSpecial } = await mount(htmlClipboard(html), (wb, id) => {
      wb.setCells(id, [{ r: 0, c: 0, cell: { v: 'old', s: { italic: true, fmt: 'number', dec: 1 } } }]);
    });
    await pasteSpecial('A1', 'Formulas only (keep formatting)');
    expect(wb.getCell(id, 0, 0)).toEqual({ v: 12, f: null, s: { italic: true, fmt: 'number', dec: 1 } });
    expect(wb.getCell(id, 0, 1)).toEqual({ v: null, f: 'A1*2' });
    expect(wb.getValue(id, 0, 1)).toBe(24);
  });

  it('reads the numbers of an arithmetic paste in the current locale', async () => {
    setLocale('de-DE');
    const { wb, id, pasteSpecial } = await mount({ readText: async () => '1.234,5\n50 %\n1,5 €\nabc' }, (wb, id) => {
      for (let r = 0; r < 4; r++) wb.setInput(id, r, 0, '10');
    });
    await pasteSpecial('A1', 'Add');
    expect([0, 1, 2, 3].map((r) => wb.getValue(id, r, 0))).toEqual([1244.5, 10.5, 11.5, 10]);
  });
});
