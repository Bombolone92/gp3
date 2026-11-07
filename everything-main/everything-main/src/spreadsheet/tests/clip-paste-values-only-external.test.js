// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { parseHtmlClipboard, cellsFromHtmlRows } from '../src/core/clipboard.js';

// Paste special → Values only over a table from a web page wrote =HYPERLINK(…) formulas for its linked
// cells and formulas for text that read as one (=1+1): cellsFromHtmlRows had already made them
// formulas and the values branch kept them. Values only should give the
// label text and no link. Every way of asking for values only (the Edit menu, the cell menu, the
// palette, Ctrl/Cmd+Shift+V) runs the same pasteValues command.
const HTML = '<table><tr><td><a href="https://example.com/a">Example</a></td><td>=1+1</td><td>12.5%</td><td><a href="https://example.com/2">42</a></td></tr></table>';

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() };
}
Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true });

describe('values only from a web table', () => {
  it('gives a link its text alone and keeps text that reads as a formula as text', () => {
    const { rows } = parseHtmlClipboard(HTML);
    const values = cellsFromHtmlRows(rows, null, { values: true }).map((e) => e.cell);
    expect(values[0]).toEqual({ v: 'Example', f: null, s: undefined });
    expect(values[1]).toEqual({ v: '=1+1', f: null, s: undefined });
    expect(values[2]).toMatchObject({ v: 0.125, f: null, s: { fmt: 'percent' } });
    expect(values[3]).toEqual({ v: 42, f: null, s: undefined });
    // A plain paste still links and computes them.
    const all = cellsFromHtmlRows(rows).map((e) => e.cell);
    expect(all[0]).toMatchObject({ v: 'Example', f: null, hyperlink: 'https://example.com/a' });
    expect(all[1].f).toBe('1+1');
    expect(all[3]).toMatchObject({ v: '42', f: null, hyperlink: 'https://example.com/2' });
  });

  it('keeps the destination\'s formatting under the pasted values', () => {
    const { rows } = parseHtmlClipboard('<table><tr><td style="font-weight:bold"><a href="https://example.com/a">Example</a></td><td>=SUM(1,2)</td></tr></table>');
    const values = cellsFromHtmlRows(rows, () => ({ italic: true }), { values: true }).map((e) => e.cell);
    expect(values[0]).toEqual({ v: 'Example', f: null, s: { italic: true, bold: true } });
    expect(values[1]).toEqual({ v: '=SUM(1,2)', f: null, s: { italic: true } });
  });
});

describe('Paste special → Values only in the editor', () => {
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

  it('writes the text and typed values of a web table, with no link and no formula', async () => {
    const clipboard = { read: async () => [{ types: ['text/html'], getType: async () => ({ text: async () => HTML }) }] };
    vi.stubGlobal('navigator', { onLine: true, clipboard });
    const doc = new Doc({ name: 'Values', path: 'Spreadsheets/Values.xlsx' });
    const wb = doc.wb;
    const id = wb.activeSheetId;
    wb.setCells(id, [{ r: 0, c: 0, cell: { v: 'old', s: { italic: true } } }]);
    wb.clearHistory();
    view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
    document.querySelector('#app').append(view.el);
    await vi.advanceTimersByTimeAsync(1);
    view.el.querySelector('.grid-viewport').focus();
    const menuItem = (label) => [...document.querySelectorAll('.menu-item')].find((b) => b.querySelector('.menu-label')?.textContent === label);
    view.goTo('Sheet1!A1');
    view.el.querySelector('[data-menu="edit"]').click();
    menuItem('Paste special').click();
    menuItem('Values only').click();
    await vi.advanceTimersByTimeAsync(5);
    expect(wb.getCell(id, 0, 0)).toEqual({ v: 'Example', f: null, s: { italic: true } });
    expect(wb.linkAt(id, 0, 0)).toBeNull();
    expect(wb.getCell(id, 0, 1)).toEqual({ v: '=1+1', f: null });
    expect(wb.getDisplay(id, 0, 1)).toBe('=1+1');
    expect(wb.getValue(id, 0, 2)).toBe(0.125);
    expect(wb.getCell(id, 0, 3)).toEqual({ v: 42, f: null });
    expect(wb.linkAt(id, 0, 3)).toBeNull();
  });
});
