// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { closeMenu } from '../src/ui/menu.js';
import * as notifications from '../src/ui/toast.js';

// Show precedents and Show dependents built their notice from the cells on the sheet shown but counted all
// of them, so a formula whose operands are all on another sheet read "A1 reads  (2 on other sheets). Escape
// clears the highlight" — two spaces, no cell named, nothing highlighted and nothing for Escape to clear.
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
afterEach(() => { closeMenu(); view?.destroy(); view = null; vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

const item = (label) => [...document.querySelectorAll('.menu-item')].find((n) => n.querySelector('.menu-label')?.textContent === label);

async function open() {
  const doc = new Doc({ name: 'Trace', path: 'Spreadsheets/Trace.xlsx' });
  const { wb } = doc;
  const first = wb.activeSheetId;
  const second = wb.addSheet('Sheet2').id;
  wb.setInput(second, 0, 0, '1');
  wb.setInput(second, 1, 0, '2');
  wb.setInput(first, 0, 0, '=Sheet2!A1+Sheet2!A2');
  wb.setActiveSheet(first);
  wb.clearHistory();
  view = editorView({ doc, goHome() {}, openPath() {}, newDoc() {}, importFile() {} });
  document.querySelector('#app').append(view.el);
  await vi.advanceTimersByTimeAsync(1);
  const toast = vi.spyOn(notifications, 'toast');
  const menu = async (...path) => {
    view.el.querySelector(`[data-menu="${path[0]}"]`).click();
    for (const label of path.slice(1)) { item(label).click(); await vi.advanceTimersByTimeAsync(1); }
  };
  return { wb, first, second, toast, menu };
}

it('says how many cells are on other sheets, and does not promise a highlight there is none of', async () => {
  const { toast, menu } = await open();
  await menu('tools', 'Show precedents');
  const said = toast.mock.calls.map(([msg]) => msg);
  expect(said).toContain('A1 reads 2 cells on other sheets');
  expect(said.some((m) => /Escape clears/.test(m))).toBe(false);
  expect(said.some((m) => m.includes('  '))).toBe(false); // the gap where no cell was named
});

it('says the same for dependents that are all on another sheet', async () => {
  const { wb, second, toast, menu } = await open();
  wb.setActiveSheet(second);
  view.goTo('Sheet2!A1');
  await vi.advanceTimersByTimeAsync(1);
  await menu('tools', 'Show dependents');
  const said = toast.mock.calls.map(([msg]) => msg);
  expect(said).toContain('Read by 1 cell on other sheets');
  expect(said.some((m) => /Escape clears/.test(m))).toBe(false);
});

it('still names the cells and offers Escape when some are on the sheet shown', async () => {
  const { wb, first, toast, menu } = await open();
  wb.setInput(first, 2, 0, '5');
  wb.setInput(first, 0, 0, '=A3+Sheet2!A1');
  wb.clearHistory();
  view.goTo('Sheet1!A1');
  await vi.advanceTimersByTimeAsync(1);
  await menu('tools', 'Show precedents');
  expect(toast.mock.calls.map(([msg]) => msg)).toContain('A1 reads A3 (1 on other sheet). Escape clears the highlight');
});
