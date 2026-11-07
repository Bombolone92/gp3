// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { closeMenu } from '../src/ui/menu.js';
import * as notifications from '../src/ui/toast.js';

// Going to a name, a #Sheet!A1 link or a ?range= target on a hidden sheet unhid the sheet: the document
// became dirty, a "Show sheet" step joined the history and the autosave wrote the unhide into the file, so
// merely opening a shared link revealed a sheet for good. Navigating is not an edit; it is refused instead.
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
  const doc = new Doc({ name: 'Hidden', path: 'Spreadsheets/Hidden.xlsx' });
  const { wb } = doc;
  const first = wb.activeSheetId;
  const second = wb.addSheet('Sheet2').id;
  wb.setInput(second, 0, 0, 'secret');
  wb.defineName('Target', 'Sheet2!$A$1');
  wb.setSheetHidden(second, true);
  wb.setActiveSheet(first);
  wb.clearHistory();
  wb.markClean();
  view = editorView({ doc, goHome() {}, openPath() {}, newDoc() {}, importFile() {} });
  document.querySelector('#app').append(view.el);
  await vi.advanceTimersByTimeAsync(1);
  const toast = vi.spyOn(notifications, 'toast');
  const nameBox = async (text) => {
    const box = view.el.querySelector('[aria-label="Cell reference"]');
    box.value = text;
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await vi.advanceTimersByTimeAsync(1);
  };
  return { wb, first, second, toast, nameBox };
}

const untouched = (wb, second) => {
  expect(wb.sheet(second).hidden).toBe(true);
  expect(wb.dirty).toBe(false);
  expect(wb.undoLabels()).toEqual([]);
};

it('refuses a named range on a hidden sheet from the name box, without revealing the sheet', async () => {
  const { wb, first, second, toast, nameBox } = await open();
  await nameBox('Target');
  untouched(wb, second);
  expect(wb.activeSheetId).toBe(first);
  expect(toast.mock.calls.some(([msg]) => /Sheet2 is hidden/.test(msg))).toBe(true);
  // The refusal is not read as a request to name the selection after it.
  expect(wb.names.map((n) => n.name)).toEqual(['Target']);
});

it('refuses a #Sheet!A1 link and a ?range= target on a hidden sheet', async () => {
  const { wb, second, nameBox } = await open();
  expect(view.goTo('Sheet2!A1')).toBe(false);
  untouched(wb, second);
  await nameBox('Sheet2!A1');
  untouched(wb, second);
});

it('still goes to a name once the sheet is on show', async () => {
  const { wb, second, nameBox } = await open();
  wb.setSheetHidden(second, false);
  wb.clearHistory();
  await nameBox('Target');
  expect(wb.activeSheetId).toBe(second);
});
