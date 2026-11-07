// @vitest-environment jsdom
import { contentSnapshot } from './helpers/content-snapshot.js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { closeMenu } from '../src/ui/menu.js';
import * as notifications from '../src/ui/toast.js';

// Insert > Checkbox over a selection with a protected cell added the checkbox rule, had its FALSE
// values refused by the workbook, and then reported "2 checkboxes inserted" beside the protection
// notice. A protected cell anywhere in the selection now refuses the insertion up front, as a
// protected sheet does, and nothing is half applied.
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
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.hasPointerCapture = () => false;
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 400 });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ measureText: (t) => ({ width: t.length * 7 }), font: '' });
  document.body.innerHTML = '<div id="app"></div>';
});
afterEach(() => { closeMenu(); view?.destroy(); view = null; vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

const item = (label) => [...document.querySelectorAll('.menu-item')].find((n) => n.querySelector('.menu-label')?.textContent === label);

async function open(protectedRange) {
  const doc = new Doc({ name: 'Boxes', path: 'Spreadsheets/Boxes.xlsx' });
  const { wb } = doc;
  const id = wb.activeSheetId;
  wb.protectRange(id, protectedRange, 'locked');
  wb.clearHistory();
  view = editorView({ doc, goHome() {}, openPath() {}, newDoc() {}, importFile() {} });
  document.querySelector('#app').append(view.el);
  await vi.advanceTimersByTimeAsync(1);
  const viewport = view.el.querySelector('.grid-viewport');
  const pe = (type, r, c, init = {}) => viewport.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: c * 100 + 50, clientY: r * 26 + 13, pointerId: 7, button: 0, pointerType: 'mouse', ...init }));
  const select = async (first, ...more) => {
    view.goTo(`Sheet1!${first}`);
    await vi.advanceTimersByTimeAsync(1);
    for (const rg of more) {
      pe('pointerdown', rg.r1, rg.c1, { ctrlKey: true, metaKey: true });
      if (rg.r2 !== rg.r1 || rg.c2 !== rg.c1) pe('pointermove', rg.r2, rg.c2, { ctrlKey: true, metaKey: true });
      pe('pointerup', rg.r2, rg.c2, { ctrlKey: true, metaKey: true });
    }
    await vi.advanceTimersByTimeAsync(1);
  };
  const toast = vi.spyOn(notifications, 'toast');
  const insertCheckbox = async () => {
    view.el.querySelector('[data-menu="insert"]').click();
    item('Checkbox').click();
    await vi.advanceTimersByTimeAsync(1);
  };
  return { wb, id, select, insertCheckbox, toast, before: JSON.stringify(contentSnapshot(wb)) };
}

it('refuses the whole insertion when the selection holds a protected cell, and says only that', async () => {
  const { wb, id, select, insertCheckbox, toast, before } = await open({ r1: 0, c1: 0, r2: 0, c2: 0 });
  await select('A1:A2');
  await insertCheckbox();
  expect(toast).toHaveBeenCalledWith(expect.stringMatching(/A1 is protected/), expect.objectContaining({ icon: 'lock' }));
  expect(toast).not.toHaveBeenCalledWith(expect.stringMatching(/checkbox/i), expect.anything());
  expect(wb.sheet(id).validations).toHaveLength(0);
  expect(wb.getValue(id, 1, 0)).toBeNull();
  expect(JSON.stringify(contentSnapshot(wb))).toBe(before);
  expect(wb.canUndo()).toBe(false);
});

it('applies nothing to a free range when a range added with Ctrl+click is protected', async () => {
  const { wb, id, select, insertCheckbox, toast, before } = await open({ r1: 0, c1: 2, r2: 0, c2: 2 });
  await select('A1:A2', { r1: 0, c1: 2, r2: 0, c2: 2 });
  await insertCheckbox();
  expect(toast).toHaveBeenCalledWith(expect.stringMatching(/C1 is protected/), expect.objectContaining({ icon: 'lock' }));
  expect(wb.sheet(id).validations).toHaveLength(0);
  expect(JSON.stringify(contentSnapshot(wb))).toBe(before);
});

it('still inserts checkboxes into a selection clear of the protected cells', async () => {
  const { wb, id, select, insertCheckbox, toast } = await open({ r1: 0, c1: 0, r2: 0, c2: 0 });
  await select('B1:B2');
  await insertCheckbox();
  expect(toast).toHaveBeenCalledWith('2 checkboxes inserted', expect.objectContaining({ icon: 'check' }));
  expect(wb.sheet(id).validations).toHaveLength(1);
  expect([wb.getValue(id, 0, 1), wb.getValue(id, 1, 1)]).toEqual([false, false]);
});
