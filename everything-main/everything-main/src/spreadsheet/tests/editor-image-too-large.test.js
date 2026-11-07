// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import * as notifications from '../src/ui/toast.js';

// Pictures on the sheet travel in the file as data URLs, so one past 12 MB is refused. The
// refusal read "Could not read that image", as for a corrupt file, and never said why.
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

it('names the size limit when a dropped picture is too large for the sheet', async () => {
  const readers = [];
  vi.stubGlobal('FileReader', class { readAsDataURL() { readers.push(this); } });
  const doc = new Doc({ name: 'Pictures', path: 'Spreadsheets/Pictures.xlsx' });
  const wb = doc.wb;
  const id = wb.activeSheetId;
  view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
  document.querySelector('#app').append(view.el);
  await vi.advanceTimersByTimeAsync(1);
  const toast = vi.spyOn(notifications, 'toast');
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  await view.acceptDrop(new File([new Uint8Array(13 * 1024 * 1024)], 'big.png', { type: 'image/png' }));
  await vi.advanceTimersByTimeAsync(5);
  expect(wb.sheet(id).charts).toHaveLength(0);
  expect(readers).toHaveLength(0); // refused before it is read
  expect(toast).toHaveBeenCalledWith(expect.stringMatching(/^big\.png .*12 MB/), expect.anything());
  expect(toast).not.toHaveBeenCalledWith('Could not read that image', expect.anything());
  expect(error).not.toHaveBeenCalled(); // an expected refusal, not a failure to report
});
