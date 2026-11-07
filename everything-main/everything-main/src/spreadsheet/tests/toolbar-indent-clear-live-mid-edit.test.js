// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { closeMenu } from '../src/ui/menu.js';

// Since 212cec6 the formatting commands act on the cell being edited, and the Format menu offers Increase
// indent, Decrease indent and Clear formatting mid-edit. The toolbar still greyed those three out, so one
// command had two availabilities on the same screen; they now follow the same rule as Bold.
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

async function open() {
  const doc = new Doc({ name: 'MidEdit', path: 'Spreadsheets/MidEdit.xlsx' });
  const { wb } = doc;
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, 'first');
  wb.applyStyle(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, { bold: true, indent: 2 });
  wb.clearHistory();
  view = editorView({ doc, goHome() {}, openPath() {}, newDoc() {}, importFile() {} });
  document.querySelector('#app').append(view.el);
  await vi.advanceTimersByTimeAsync(1);
  const viewport = view.el.querySelector('.grid-viewport');
  viewport.focus();
  viewport.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true, cancelable: true }));
  await vi.advanceTimersByTimeAsync(1);
  const button = (label) => view.el.querySelector(`[aria-label="${label}"]`);
  return { wb, id, button };
}

/** Home ▸ Clear ▸ Clear Formats, the ribbon's way to clear formatting. */
function clearFormatsItem() {
  view.el.querySelector('.ribbon-home button[aria-label="Clear"]').click();
  return [...document.querySelectorAll('.menu-item')].find((n) => n.querySelector('.menu-label')?.textContent === 'Clear Formats');
}
async function clearFormats() {
  clearFormatsItem().click();
  await vi.advanceTimersByTimeAsync(1);
}

it('leaves Increase indent, Decrease indent and Clear formatting live while a cell is being edited', async () => {
  const { button } = await open();
  expect(view.el.querySelector('.grid-editor')).not.toBeNull();
  for (const label of ['Increase indent', 'Decrease indent', 'Clear']) {
    expect(button(label).disabled, label).toBe(false);
  }
  expect(clearFormatsItem().getAttribute('aria-disabled')).not.toBe('true');
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  // The commands that really do wait for the edit to end are still greyed out.
  for (const label of ['Format Painter', 'Undo']) expect(button(label).disabled, label).toBe(true);
});

it('runs them on the cell being edited, as the Format menu already did', async () => {
  const { wb, id, button } = await open();
  button('Increase indent').click();
  await vi.advanceTimersByTimeAsync(1);
  expect(wb.getCell(id, 0, 0).s.indent).toBe(3);
  expect(view.el.querySelector('.grid-editor').style.paddingLeft).toBe('38px');
  button('Decrease indent').click();
  await vi.advanceTimersByTimeAsync(1);
  expect(wb.getCell(id, 0, 0).s.indent).toBe(2);
  expect(view.el.querySelector('.grid-editor').style.paddingLeft).toBe('26px');
  await clearFormats();
  expect(wb.getCell(id, 0, 0).s).toBeUndefined();
  expect(view.el.querySelector('.grid-editor').style.paddingLeft).toBe('');
  // The entry is still open; the toolbar never committed it.
  expect(view.el.querySelector('.grid-editor')).not.toBeNull();
});

it('greys Decrease indent out again at zero, whether or not a cell is being edited', async () => {
  const { wb, id, button } = await open();
  await clearFormats();
  expect(button('Decrease indent').disabled).toBe(true);
  expect(button('Increase indent').disabled).toBe(false);
  expect(wb.getCell(id, 0, 0).s).toBeUndefined();
});
