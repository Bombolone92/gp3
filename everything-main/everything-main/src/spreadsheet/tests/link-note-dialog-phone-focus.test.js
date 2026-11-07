// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { closeMenu } from '../src/ui/menu.js';
import { closeAllModals } from '../src/ui/modal.js';

// The Insert link and Note dialogs focused their field themselves, so on a phone the soft keyboard
// opened over the bottom sheet and hid the form; they now name the field through openModal, whose
// screen-size guard applies to them as to every other dialog.
function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() };
}
Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true });

let view;
let phone = false;
beforeEach(() => {
  vi.useFakeTimers();
  // Only the dialogs' own screen-size guard sees a phone; the editor keeps its full layout for the menus.
  vi.stubGlobal('matchMedia', (query) => ({ matches: query.includes('min-width') ? !phone : true, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('requestAnimationFrame', (fn) => setTimeout(fn, 0));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.scrollTo = () => {};
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 400 });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ measureText: (t) => ({ width: t.length * 7 }), font: '' });
  document.body.innerHTML = '<div id="app"></div>';
});
afterEach(() => { closeMenu(); closeAllModals(); view?.destroy(); view = null; vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

const item = (label) => [...document.querySelectorAll('.menu-item')].find((n) => n.querySelector('.menu-label')?.textContent === label);

async function open(cell) {
  const doc = new Doc({ name: 'Notes', path: 'Spreadsheets/Notes.xlsx' });
  const { wb } = doc;
  const id = wb.activeSheetId;
  wb.setInput(id, 1, 0, 'Home page');
  wb.setNote(id, 2, 0, 'A note');
  view = editorView({ doc, goHome() {}, openPath() {}, newDoc() {}, importFile() {} });
  document.querySelector('#app').append(view.el);
  await vi.advanceTimersByTimeAsync(1);
  view.goTo(`Sheet1!${cell}`);
  await vi.advanceTimersByTimeAsync(1);
  return async (label) => {
    view.el.querySelector('[data-menu="insert"]').click();
    item(label).click();
    await vi.advanceTimersByTimeAsync(1);
    return document.querySelector('.modal-panel');
  };
}

describe('on a phone', () => {
  beforeEach(() => { phone = true; });
  afterEach(() => { phone = false; });
  it.each([['Link…', 'A2'], ['Note', 'A1'], ['Edit note', 'A3']])('%s leaves the focus on the sheet itself, keeping the keyboard down', async (label, cell) => {
    const insert = await open(cell);
    const panel = await insert(label);
    expect(panel).not.toBeNull();
    expect(document.activeElement).toBe(panel);
  });
});

describe('on a larger screen', () => {
  it('starts Insert link on the address for a cell with text, and on the text for an empty cell', async () => {
    const insert = await open('A2');
    let panel = await insert('Link…');
    expect(document.activeElement).toBe(panel.querySelector('[aria-label="Link"]'));
    closeAllModals();
    await vi.advanceTimersByTimeAsync(500);
    view.goTo('Sheet1!A1');
    await vi.advanceTimersByTimeAsync(1);
    panel = await insert('Link…');
    expect(document.activeElement).toBe(panel.querySelector('[aria-label="Text"]'));
  });
  it('starts the Note dialog in the note, with the caret after its text', async () => {
    const insert = await open('A3');
    const panel = await insert('Edit note');
    const area = panel.querySelector('[aria-label="Note"]');
    expect(document.activeElement).toBe(area);
    expect([area.selectionStart, area.selectionEnd]).toEqual([6, 6]);
  });
});
