// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import * as notifications from '../src/ui/toast.js';

// Ctrl+; (today's date), Ctrl+Shift+; (the time), Ctrl+' and Ctrl+Shift+" (the cell above) wrote
// straight into a cell whose strict validation rule refused the value, with no notice, where typing
// the same text and pressing Enter is refused with the rule's message. The chords now go through the
// same check; a rule that only marks invalid entries still lets them write, and paste is unchanged.
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
afterEach(() => { view?.destroy(); view = null; vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

const B = 1;
/** B1 holds `above`; B2 has a Yes/No list rule (strict unless said otherwise); the editor sits on B2. */
async function setup({ above = 'hello', strict = true } = {}) {
  const doc = new Doc({ name: 'Rules', path: 'Spreadsheets/Rules.xlsx' });
  const wb = doc.wb;
  const id = wb.activeSheetId;
  wb.setInput(id, 0, B, above);
  wb.addValidation(id, { range: { r1: 1, c1: B, r2: 1, c2: B }, type: 'list', source: 'Yes,No', strict });
  wb.clearHistory();
  view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
  document.querySelector('#app').append(view.el);
  await vi.advanceTimersByTimeAsync(1);
  view.goTo('Sheet1!B2');
  await vi.advanceTimersByTimeAsync(1);
  const viewport = view.el.querySelector('.grid-viewport');
  viewport.focus();
  const toast = vi.spyOn(notifications, 'toast');
  const key = (k, init = {}) => viewport.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));
  return { wb, id, toast, key, viewport };
}

/** Type `text` into the active cell and press Enter; the rule's refusal, if any, is the last toast. */
function typeAndEnter(view, key, text) {
  key(text[0]);
  const editor = view.el.querySelector('.grid-editor');
  editor.value = text;
  editor.dispatchEvent(new Event('input', { bubbles: true }));
  editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  return editor;
}

/** The open Stop alert, if any: its title, message and buttons. */
function alertShown() {
  const panel = document.querySelector('.modal-root:not(.closing) .modal-panel[role="dialog"]');
  if (!panel) return null;
  return { title: panel.querySelector('.modal-title')?.textContent, message: panel.querySelector('.modal-text')?.textContent,
    button: (label) => [...panel.querySelectorAll('button')].find((b) => b.textContent === label) };
}

it('refuses today\'s date, the time and the cell above under a strict rule with the alert a typed entry gets', async () => {
  const { wb, id, toast, key } = await setup();
  // What typing the date and pressing Enter shows: the rule's Stop alert.
  const editor = typeAndEnter(view, key, '2026-09-14');
  await vi.advanceTimersByTimeAsync(1);
  expect(wb.getValue(id, 1, B)).toBeNull();
  expect(editor.hidden).toBe(false); // the entry stays open to be fixed
  const typed = alertShown();
  expect(typed?.message).toBeTruthy();
  expect(typed.button('Retry')).toBeTruthy();
  typed.button('Cancel').click();
  await vi.advanceTimersByTimeAsync(1);
  for (const [k, init, what] of [
    [';', { ctrlKey: true, metaKey: true }, 'Ctrl+;'],
    [';', { ctrlKey: true, metaKey: true, shiftKey: true }, 'Ctrl+Shift+;'],
    ['"', { ctrlKey: true, metaKey: true, shiftKey: true }, 'Ctrl+Shift+"'],
    ["'", { ctrlKey: true, metaKey: true }, "Ctrl+'"],
  ]) {
    key(k, init);
    await vi.advanceTimersByTimeAsync(1);
    expect(wb.getValue(id, 1, B), what).toBeNull();
    expect(wb.getCell(id, 1, B)?.f ?? null, what).toBeNull();
    const shown = alertShown();
    expect({ title: shown?.title, message: shown?.message }, what).toEqual({ title: typed.title, message: typed.message });
    shown.button('Cancel').click();
    await vi.advanceTimersByTimeAsync(1);
    expect(alertShown(), what).toBeNull();
  }
  // The Stop alert is the notice: no toast repeats it.
  expect(toast).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ icon: 'alert' }));
  expect(wb.canUndo()).toBe(false);
});

it('returns to the refused entry on Retry for a chord that fills the entry', async () => {
  const { wb, id, key } = await setup();
  key(';', { ctrlKey: true, metaKey: true, shiftKey: true });
  await vi.advanceTimersByTimeAsync(1);
  alertShown().button('Retry').click();
  await vi.advanceTimersByTimeAsync(1);
  const editor = view.el.querySelector('.grid-editor');
  expect(editor.hidden).toBe(false);
  expect(editor.value).toMatch(/^\d{2}:\d{2}$/);
  editor.value = 'Yes';
  editor.dispatchEvent(new Event('input', { bubbles: true }));
  editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await vi.advanceTimersByTimeAsync(1);
  expect(wb.getValue(id, 1, B)).toBe('Yes');
});

it('still writes under a rule that only marks invalid entries, and a value the rule accepts', async () => {
  const { wb, id, toast, key } = await setup({ above: 'Yes', strict: false });
  key(';', { ctrlKey: true, metaKey: true });
  await vi.advanceTimersByTimeAsync(1);
  expect(typeof wb.getValue(id, 1, B)).toBe('number'); // today's date serial
  expect(wb.validateCell(id, 1, B).ok).toBe(false); // marked invalid, as a typed date would be
  expect(toast).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ icon: 'alert' }));
  key('"', { ctrlKey: true, metaKey: true, shiftKey: true });
  await vi.advanceTimersByTimeAsync(1);
  expect(wb.getValue(id, 1, B)).toBe('Yes');
});

it('copies an accepted value from the cell above under a strict rule', async () => {
  const { wb, id, toast, key } = await setup({ above: 'No' });
  key("'", { ctrlKey: true, metaKey: true });
  await vi.advanceTimersByTimeAsync(1);
  expect(wb.getValue(id, 1, B)).toBe('No');
  expect(toast).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ icon: 'alert' }));
});
