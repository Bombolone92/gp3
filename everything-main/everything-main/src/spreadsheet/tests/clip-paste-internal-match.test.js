// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { cellsToHtml, parseHtmlClipboard } from '../src/core/clipboard.js';

// A paste is this tab's own copy when the clipboard text matches what was last copied here,
// unless the HTML says otherwise. HTML from another tab of this app carries the same kind of
// cells this tab embeds, so it passed for this tab's copy whenever the two displayed the same
// text, and this tab's cells were pasted instead of the other tab's. Each copy now carries an
// id the paste checks.
function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() };
}
Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true });

describe('telling this tab\'s copy from a matching clipboard', () => {
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
    const doc = new Doc({ name: 'Match', path: 'Spreadsheets/Match.xlsx' });
    const wb = doc.wb;
    const id = wb.activeSheetId;
    prep(wb, id);
    wb.clearHistory();
    view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
    document.querySelector('#app').append(view.el);
    await vi.advanceTimersByTimeAsync(1);
    const viewport = view.el.querySelector('.grid-viewport');
    viewport.focus();
    let copied = {};
    const clipboardEvent = (type, data = {}) => {
      const e = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(e, 'clipboardData', { value: { getData: (t) => data[t] ?? '', setData: (t, v) => { copied[t] = v; }, files: [] } });
      return e;
    };
    const copy = (where, cut = false) => { copied = {}; view.goTo(`Sheet1!${where}`); viewport.dispatchEvent(clipboardEvent(cut ? 'cut' : 'copy')); return copied; };
    const paste = (where, data) => { view.goTo(`Sheet1!${where}`); viewport.dispatchEvent(clipboardEvent('paste', data)); };
    return { wb, id, copy, paste };
  }

  it('pastes another tab\'s cells, not this tab\'s, when both show the same text', async () => {
    const { wb, id, copy, paste } = await mount((wb, id) => {
      wb.setInput(id, 0, 1, '5');
      wb.setInput(id, 0, 2, '2');
      wb.setInput(id, 0, 0, '=B1*2');
      wb.setInput(id, 0, 3, '=C1*5');
    });
    const own = copy('D1');
    expect(own['text/plain']).toBe('10');
    // What another tab of this app puts on the clipboard for its A1 (=B1*2, also showing 10).
    const theirs = cellsToHtml([['10']], [[{ v: null, f: 'B1*2' }]], null, [[10]], { r: 0, c: 0 });
    paste('F1', { 'text/plain': '10', 'text/html': theirs });
    expect(wb.getCell(id, 0, 5).f).toBe('G1*2');
    // This tab's own HTML, as the browser hands it back wrapped in a document, is still its own copy.
    paste('H1', { 'text/plain': '10', 'text/html': `<html><body><!--StartFragment-->${own['text/html']}<!--EndFragment--></body></html>` });
    expect(wb.getCell(id, 0, 7).f).toBe('G1*5');
    // The copy's tag rides on the table and does not disturb how the cells are read back from it.
    expect(parseHtmlClipboard(own['text/html'])).toMatchObject({ cells: [[{ f: 'C1*5' }]], origin: { r: 0, c: 3 } });
    // Copying again makes a new copy: HTML kept from the previous one is no longer this tab's clipboard.
    const before = own['text/html'];
    copy('A1');
    paste('J1', { 'text/plain': '10', 'text/html': before });
    expect(wb.getCell(id, 0, 9).f).toBe('I1*5');
  });

  // Windows hands the text back with CRLF line ends, so a multi-line cut no longer read as this
  // tab's own clipboard: the cells were copied, with the source left in place and no notice.
  it('still moves a cut block when the clipboard returns its text with CRLF line ends', async () => {
    const { wb, id, copy, paste } = await mount((wb, id) => {
      wb.setInput(id, 0, 0, '=B1*2');
      wb.setInput(id, 1, 0, 'x');
      wb.setInput(id, 0, 1, '5');
    });
    const own = copy('A1:A2', true);
    expect(own['text/plain']).toBe('10\nx');
    paste('D1', { 'text/plain': own['text/plain'].replace(/\n/g, '\r\n'), 'text/html': own['text/html'] });
    expect(wb.getCell(id, 0, 0)).toBeFalsy();
    expect(wb.getCell(id, 1, 0)).toBeFalsy();
    expect(wb.getCell(id, 0, 3).f).toBe('B1*2'); // moved, so it keeps pointing at B1
    expect(wb.getValue(id, 0, 3)).toBe(10);
    expect(wb.getValue(id, 1, 3)).toBe('x');
    expect(wb.undoLabels()).toEqual(['Move cells']);
    // A trailing line end added by the system is no different.
    copy('B1', true);
    paste('F1', { 'text/plain': '5\r\n' });
    expect(wb.getCell(id, 0, 1)).toBeFalsy();
    expect(wb.getValue(id, 0, 5)).toBe(5);
  });

  it.each([false, true])('does not revive a retained copy token after a foreign copy (cut=%s)', async (cut) => {
    const { wb, id, copy, paste } = await mount((wb, id) => wb.setInput(id, 0, 0, '=5*2'));
    const own = copy('A1', cut);
    // Another app retains the table attributes but copies a different cell
    // with the same displayed value. A text or copy-token match is insufficient.
    const html = new DOMParser().parseFromString(own['text/html'], 'text/html');
    html.querySelector('tr').innerHTML = '<td class="other" x:num="10">10</td>';
    paste('D1', { 'text/plain': '10', 'text/html': html.body.innerHTML });
    expect(wb.getCell(id, 0, 3).f).toBeNull();
    expect(wb.getValue(id, 0, 3)).toBe(10);
    expect(wb.getCell(id, 0, 0).f).toBe('5*2');
    expect(wb.undoLabels()).toEqual(['Paste']);
  });

  it('distinguishes foreign HTML after a copy larger than the embedded-formula limit', async () => {
    const { wb, id, copy, paste } = await mount((wb, id) =>
      wb.setCells(id, Array.from({ length: 5001 }, (_, r) => ({ r, c: 0, cell: { f: '5*2' } }))));
    const own = copy('A1:A5001');
    expect(own['text/html']).not.toContain('data-spreadsheet-cells=');
    paste('B1', { 'text/plain': own['text/plain'], 'text/html': `<pre>${own['text/plain']}</pre>` });
    for (const r of [0, 5000]) expect(wb.getCell(id, r, 1)).toMatchObject({ v: 10, f: null });
    paste('C1', own);
    for (const r of [0, 5000]) expect(wb.getCell(id, r, 2).f).toBe('5*2');
  });
});
