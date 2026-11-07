// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import * as P from '../src/lib/puter.js';
import * as notifications from '../src/ui/toast.js';

// Web fetches are capped and throw a "too large" error past the cap. The IMPORT
// providers turned every failure into a bare #N/A, and the URL import and image
// commands into a generic toast, so the size problem was never named.
function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() };
}
Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true });

const TOO_LARGE = 'The response from https://example.com/big.csv is too large (over 20 MB)';

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

async function mount() {
  const doc = new Doc({ name: 'Imports', path: 'Spreadsheets/Imports.xlsx' });
  view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
  document.querySelector('#app').append(view.el);
  await vi.advanceTimersByTimeAsync(1);
  return { wb: doc.wb, id: doc.wb.activeSheetId };
}
const menuItem = (label) => [...document.querySelectorAll('.menu-item')].find((n) => n.querySelector('.menu-label')?.textContent === label);

it('shows #VALUE! with the reason for an import that is too large, and #N/A with the reason otherwise', async () => {
  const { wb, id } = await mount();
  const fetchText = vi.spyOn(P, 'fetchText').mockRejectedValue(Object.assign(new Error(TOO_LARGE), { code: 'too-large' }));
  wb.setInput(id, 0, 0, '=IMPORTDATA("https://example.com/big.csv")');
  wb.getValue(id, 0, 0);
  await vi.advanceTimersByTimeAsync(20);
  expect(wb.getValue(id, 0, 0)).toMatchObject({ error: '#VALUE!', message: TOO_LARGE });
  expect(view.el.querySelector('.status-error').textContent).toBe(TOO_LARGE);
  fetchText.mockRejectedValue(new Error('Could not fetch https://example.com/a.csv'));
  wb.setInput(id, 1, 0, '=IMPORTDATA("https://example.com/a.csv")');
  wb.getValue(id, 1, 0);
  await vi.advanceTimersByTimeAsync(20);
  expect(wb.getValue(id, 1, 0)).toMatchObject({ error: '#N/A', message: 'Could not fetch https://example.com/a.csv' });
});

it('names the size problem when an image from a URL is too large', async () => {
  await mount();
  vi.spyOn(P, 'fetchBytes').mockRejectedValue(Object.assign(new Error('The response from https://example.com/huge.png is too large (over 20 MB)'), { code: 'too-large' }));
  const toast = vi.spyOn(notifications, 'toast');
  view.el.querySelector('[data-menu="insert"]').click();
  menuItem('Image').click();
  menuItem('From a URL…').click();
  await vi.advanceTimersByTimeAsync(1);
  const input = document.querySelector('.modal-panel[aria-label="Insert image from URL"] input');
  input.value = 'https://example.com/huge.png';
  input.form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await vi.advanceTimersByTimeAsync(5);
  expect(toast).toHaveBeenCalledWith(expect.stringMatching(/too large \(over 20 MB\)/), expect.objectContaining({ icon: 'alert' }));
  expect(toast).not.toHaveBeenCalledWith('Could not fetch that image', expect.anything());
});

it('does not take a server\'s own "too large" wording for the size cap', async () => {
  const { wb, id } = await mount();
  vi.spyOn(P, 'fetchText').mockRejectedValue(new Error('Request entity too large'));
  wb.setInput(id, 0, 0, '=IMPORTDATA("https://example.com/a.csv")');
  wb.getValue(id, 0, 0);
  await vi.advanceTimersByTimeAsync(20);
  expect(wb.getValue(id, 0, 0)).toMatchObject({ error: '#N/A', message: 'Request entity too large' });
});
