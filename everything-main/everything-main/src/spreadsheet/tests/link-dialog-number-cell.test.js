// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { closeAllModals } from '../src/ui/modal.js';

// The link dialog offered a number cell's formatted text ("$1,000.00") as the link text and handed
// that text to the workbook, so inserting a link turned the number into text and a SUM over it
// dropped to 0. When the Text field is left as it was, the cell's own value goes to the workbook.
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

async function open(cell) {
  const doc = new Doc({ name: 'Links', path: 'Spreadsheets/Links.xlsx' });
  const { wb } = doc;
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '1000');
  wb.applyStyle(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, { fmt: 'currency' });
  wb.setInput(id, 1, 0, 'TRUE');
  wb.setInput(id, 2, 0, 'Home page');
  wb.clearHistory();
  view = editorView({ doc, goHome() {}, openPath() {}, newDoc() {}, importFile() {} });
  document.querySelector('#app').append(view.el);
  await vi.advanceTimersByTimeAsync(1);
  view.goTo(`Sheet1!${cell}`);
  await vi.advanceTimersByTimeAsync(1);
  const setLink = vi.spyOn(wb, 'setLink');
  view.el.querySelector('[aria-label="Insert link"]').click();
  const text = document.querySelector('input[aria-label="Text"]');
  const url = document.querySelector('input[aria-label="Link"]');
  const submit = (address = 'https://example.com') => { url.value = address; url.closest('form').requestSubmit(); };
  return { wb, id, setLink, text, submit };
}

it('shows a number cell as it is formatted, and hands the workbook the number when the text is left alone', async () => {
  const { wb, id, setLink, text, submit } = await open('A1');
  expect(text.value).toBe(wb.getDisplay(id, 0, 0));
  expect(text.value).not.toBe('1000');
  submit();
  expect(setLink).toHaveBeenCalledWith(id, 0, 0, 'https://example.com', 1000);
});

it('hands the workbook a boolean cell’s value the same way', async () => {
  const { id, setLink, text, submit } = await open('A2');
  expect(text.value).toBe('TRUE');
  submit();
  expect(setLink).toHaveBeenCalledWith(id, 1, 0, 'https://example.com', true);
});

it('hands over the text typed into the Text field once it is changed, and a text cell’s text as before', async () => {
  const { id, setLink, text, submit } = await open('A1');
  text.value = 'One thousand';
  submit();
  expect(setLink).toHaveBeenCalledWith(id, 0, 0, 'https://example.com', 'One thousand');
  closeAllModals();
  await vi.advanceTimersByTimeAsync(500); // the closed dialog leaves once its closing animation is over
  expect(document.querySelector('.modal-panel')).toBeNull();
  view.goTo('Sheet1!A3');
  await vi.advanceTimersByTimeAsync(1);
  view.el.querySelector('[aria-label="Insert link"]').click();
  const url = document.querySelector('input[aria-label="Link"]');
  url.value = 'https://example.org';
  url.closest('form').requestSubmit();
  expect(setLink.mock.calls).toEqual([[id, 0, 0, 'https://example.com', 'One thousand'], [id, 2, 0, 'https://example.org', 'Home page']]);
});
