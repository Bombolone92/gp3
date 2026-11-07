// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';

// Text entered with Alt+Enter turns wrapping on so the row can show every
// line; text pasted with line breaks arrives the same way instead of clipped.
function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() };
}
Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true });

describe('pasting text with line breaks', () => {
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

  async function mount(clipboard = {}) {
    vi.stubGlobal('navigator', { onLine: true, clipboard });
    const doc = new Doc({ name: 'Lines', path: 'Spreadsheets/Lines.xlsx' });
    const wb = doc.wb;
    const id = wb.activeSheetId;
    wb.clearHistory();
    view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
    document.querySelector('#app').append(view.el);
    await vi.advanceTimersByTimeAsync(1);
    const viewport = view.el.querySelector('.grid-viewport');
    viewport.focus();
    const paste = (where, data) => {
      view.goTo(`Sheet1!${where}`);
      const e = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(e, 'clipboardData', { value: { getData: (t) => data[t] ?? '', setData() {}, files: [] } });
      viewport.dispatchEvent(e);
    };
    const menuItem = (label) => [...document.querySelectorAll('.menu-item')].find((b) => b.querySelector('.menu-label')?.textContent === label);
    const pasteSpecial = async (where, label) => {
      view.goTo(`Sheet1!${where}`);
      view.el.querySelector('[data-menu="edit"]').click();
      menuItem('Paste special').click();
      menuItem(label).click();
      await vi.advanceTimersByTimeAsync(5);
    };
    return { wb, id, paste, pasteSpecial };
  }

  it('turns wrapping on for the multi-line cells of pasted text, in the paste\'s undo step', async () => {
    const { wb, id, paste } = await mount();
    wb.applyStyle(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, { bold: true });
    wb.clearHistory();
    paste('A1', { 'text/plain': '"line one\nline two"\tplain\n=1+1\t"x\ny"' });
    expect(wb.getCell(id, 0, 0)).toEqual({ v: 'line one\nline two', f: null, s: { bold: true, wrap: true } });
    expect(wb.getCell(id, 0, 1)).toEqual({ v: 'plain', f: null });
    expect(wb.getCell(id, 1, 0).f).toBe('1+1');
    expect(wb.getCell(id, 1, 1).s).toEqual({ wrap: true });
    expect(wb.undoLabels()).toEqual(['Paste']);
    wb.undo();
    expect(wb.getCell(id, 0, 0)).toEqual({ v: null, f: null, s: { bold: true } });
  });

  it('wraps a multi-line cell of a pasted web table, with formatting or values only', async () => {
    const html = '<table><tr><td style="color:#ff0000">a<br>b</td><td>c</td></tr></table>';
    const { wb, id, paste, pasteSpecial } = await mount({ read: async () => [{ types: ['text/html'], getType: async () => ({ text: async () => html }) }] });
    paste('A1', { 'text/html': html });
    expect(wb.getCell(id, 0, 0)).toEqual({ v: 'a\nb', f: null, s: { color: '#ff0000', wrap: true } });
    await pasteSpecial('A3', 'Values only');
    expect(wb.getCell(id, 2, 0)).toEqual({ v: 'a\nb', f: null, s: { wrap: true } });
    expect(wb.getCell(id, 2, 1)).toEqual({ v: 'c', f: null, s: undefined });
  });

  it('wraps a multi-line value pasted as values only from the text', async () => {
    const { wb, id, pasteSpecial } = await mount({ readText: async () => '"first\nsecond"' });
    await pasteSpecial('B2', 'Values only');
    expect(wb.getCell(id, 1, 1)).toEqual({ v: 'first\nsecond', f: null, s: { wrap: true } });
  });
});
