// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { closeAllModals } from '../src/ui/modal.js';

// New spreadsheet, New from template, Import from this device and a dropped
// file all save the open document first. When the editor was left while that
// save ran (the back arrow, a link), the finished save still opened the new
// document or ran the import over whatever screen was showing by then.
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

const menuItem = (label) => [...document.querySelectorAll('.menu-item')].find((n) => n.querySelector('.menu-label')?.textContent === label);
const fileMenu = (label) => { view.el.querySelector('[data-menu="file"]').click(); menuItem(label).click(); };

/** An editor on an unsaved document whose save waits until `release()` is called. */
async function mount() {
  const doc = new Doc({ name: 'Budget', path: null });
  doc.wb.setInput(doc.wb.activeSheetId, 0, 0, 'unsaved');
  let release;
  const save = vi.spyOn(doc, 'save').mockImplementation(() => new Promise((resolve) => { release = () => { doc.wb.markClean(); resolve(true); }; }));
  const handlers = { goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() };
  view = editorView({ doc, ...handlers });
  document.querySelector('#app').append(view.el);
  await vi.advanceTimersByTimeAsync(1);
  const leaveThenRelease = async () => {
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalled();
    view.destroy();
    view = null;
    release();
    await vi.advanceTimersByTimeAsync(5);
  };
  return { doc, handlers, leaveThenRelease, release: () => release() };
}

it('does not open a new spreadsheet after the editor was left', async () => {
  const { handlers, leaveThenRelease } = await mount();
  fileMenu('New spreadsheet');
  await leaveThenRelease();
  expect(handlers.newDoc).not.toHaveBeenCalled();
});

it('does not open a template picked before the editor was left', async () => {
  const { handlers, leaveThenRelease } = await mount();
  fileMenu('New from template…');
  await vi.advanceTimersByTimeAsync(1);
  document.querySelector('.template-card').click();
  await leaveThenRelease();
  expect(handlers.templateDoc).not.toHaveBeenCalled();
});

it('does not import a file chosen from the device after the editor was left', async () => {
  const { handlers, leaveThenRelease } = await mount();
  const input = view.el.querySelector('input[type="file"][accept^=".xlsx"]');
  Object.defineProperty(input, 'files', { value: [new File(['a,b'], 'data.csv', { type: 'text/csv' })], configurable: true });
  input.dispatchEvent(new Event('change'));
  await leaveThenRelease();
  expect(handlers.importFile).not.toHaveBeenCalled();
});

it('does not import a dropped spreadsheet after the editor was left', async () => {
  const { handlers, leaveThenRelease } = await mount();
  view.acceptDrop(new File(['a,b'], 'data.csv', { type: 'text/csv' }));
  await leaveThenRelease();
  expect(handlers.importFile).not.toHaveBeenCalled();
});

it('still opens the new spreadsheet once the save is through when the editor stays', async () => {
  const { handlers, release } = await mount();
  fileMenu('New spreadsheet');
  await vi.advanceTimersByTimeAsync(1);
  expect(handlers.newDoc).not.toHaveBeenCalled(); // waiting on the save
  release();
  await vi.advanceTimersByTimeAsync(5);
  expect(handlers.newDoc).toHaveBeenCalledOnce();
});
