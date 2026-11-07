// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { closeAllModals } from '../src/ui/modal.js';

// Edit link → Save with nothing changed rewrote the cell: =HYPERLINK("…",1000) came back as
// =HYPERLINK("…","1000") (a SUM over it dropped to 0), a typed address became a formula, and an
// "Edit cell" step was recorded. An unchanged dialog now writes nothing, and a link whose address
// alone changes keeps its label's own value rather than the text the cell showed.
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
afterEach(() => { closeAllModals(); view?.destroy(); view = null; vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

/** A1 holding `input` (with `style`), the editor on it and its Edit link dialog open. */
async function open(input, style = null) {
  const doc = new Doc({ name: 'Links', path: 'Spreadsheets/Links.xlsx' });
  const { wb } = doc;
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, input);
  if (style) wb.applyStyle(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, style);
  wb.clearHistory();
  wb.markClean();
  view = editorView({ doc, goHome() {}, openPath() {}, newDoc() {}, importFile() {} });
  document.querySelector('#app').append(view.el);
  await vi.advanceTimersByTimeAsync(1);
  view.goTo('Sheet1!A1');
  await vi.advanceTimersByTimeAsync(1);
  const before = JSON.stringify(wb.toJSON());
  view.el.querySelector('[aria-label="Insert link"]').click();
  const text = document.querySelector('input[aria-label="Text"]');
  const url = document.querySelector('input[aria-label="Link"]');
  const submit = () => text.closest('form').requestSubmit();
  const cell = () => wb.getCell(id, 0, 0);
  return { wb, id, before, text, url, submit, cell, title: document.querySelector('.modal-title').textContent };
}

it('leaves a numeric HYPERLINK label numeric when the dialog is saved as it was, with nothing to undo', async () => {
  const { wb, id, before, text, url, submit, cell, title } = await open('=HYPERLINK("https://example.com",1000)', { fmt: 'currency' });
  expect(title).toBe('Edit link');
  expect(text.value).toBe(wb.getDisplay(id, 0, 0)); // shown as the cell formats it
  expect(url.value).toBe('https://example.com');
  submit();
  await vi.advanceTimersByTimeAsync(500);
  expect(document.querySelector('.modal-panel')).toBeNull();
  expect(cell().f).toBe('HYPERLINK("https://example.com",1000)');
  expect(wb.getValue(id, 0, 0)).toBe(1000);
  expect(JSON.stringify(wb.toJSON())).toBe(before);
  expect(wb.canUndo()).toBe(false);
});

it('leaves a typed address as typed text when the dialog is saved as it was', async () => {
  const { wb, before, text, url, submit, cell } = await open('https://example.com');
  expect(text.value).toBe('https://example.com');
  expect(url.value).toBe('https://example.com');
  submit();
  expect(cell()).toMatchObject({ v: 'https://example.com' });
  expect(cell().f == null).toBe(true);
  expect(JSON.stringify(wb.toJSON())).toBe(before);
  expect(wb.canUndo()).toBe(false);
});

it('keeps a text label as it was, and records nothing, for an unchanged =HYPERLINK("…","Label")', async () => {
  const { wb, submit, cell } = await open('=HYPERLINK("https://example.com","Home")');
  submit();
  expect(cell().f).toBe('HYPERLINK("https://example.com","Home")');
  expect(wb.canUndo()).toBe(false);
});

it('hands the label\'s own value back when only the address changes, so a number stays a number', async () => {
  const { wb, id, url, submit, cell } = await open('=HYPERLINK("https://example.com",1000)', { fmt: 'currency' });
  url.value = 'https://example.org';
  submit();
  expect(cell().f).toBe('HYPERLINK("https://example.org",1000)');
  expect(wb.getValue(id, 0, 0)).toBe(1000);
  expect(wb.getDisplay(id, 0, 0)).toBe('$1,000.00');
  expect(wb.undoLabel()).toBe('Set link');
});

it('still writes the text typed into the Text field when it is changed', async () => {
  const { wb, id, text, submit, cell } = await open('=HYPERLINK("https://example.com",1000)');
  text.value = 'One thousand';
  submit();
  expect(cell().f).toBe('HYPERLINK("https://example.com","One thousand")');
  expect(wb.getValue(id, 0, 0)).toBe('One thousand');
});

it('turns a typed address into a link when its address alone changes', async () => {
  const { wb, id, url, submit } = await open('https://example.com');
  url.value = 'https://example.org';
  submit();
  expect(wb.linkAt(id, 0, 0)?.url).toBe('https://example.org');
  expect(wb.undoLabel()).toBe('Set link');
});
