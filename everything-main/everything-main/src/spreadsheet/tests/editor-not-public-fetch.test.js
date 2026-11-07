// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import * as P from '../src/lib/puter.js';
import * as notifications from '../src/ui/toast.js';
import { closeAllModals } from '../src/ui/modal.js';

// The fetch helpers refuse an address that is not on the public internet (this computer, a private
// network) before any request goes out, with `code: 'not-public'` and a message that says so. The
// editor knew only the "too large" refusal as one worth showing, so this one came through as a bare
// #VALUE! or the generic "Could not fetch" toast.
vi.mock('../src/lib/puter.js', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchText: vi.fn(),
  fetchBytes: vi.fn(),
  isPublicHttpUrl: vi.fn(),
}));

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() };
}
Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true });

const refusal = (url) => Object.assign(new Error(`Cannot fetch ${url}: only addresses on the public internet can be fetched, not this computer's or a private network's`), { code: 'not-public' });

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
  P.fetchText.mockReset();
  P.fetchBytes.mockReset();
  P.isPublicHttpUrl.mockReset();
  P.isPublicHttpUrl.mockReturnValue(undefined); // as when the helper is not there: the dialog lets the address through
});
afterEach(() => { closeAllModals(); view?.destroy(); view = null; vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

async function mount() {
  const doc = new Doc({ name: 'Imports', path: 'Spreadsheets/Imports.xlsx' });
  view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
  document.querySelector('#app').append(view.el);
  await vi.advanceTimersByTimeAsync(1);
  return { wb: doc.wb, id: doc.wb.activeSheetId };
}
const menuItem = (label) => [...document.querySelectorAll('.menu-item')].find((n) => n.querySelector('.menu-label')?.textContent === label);
const submitUrl = (dialogLabel, url) => {
  const input = document.querySelector(`.modal-panel[aria-label="${dialogLabel}"] input`);
  input.value = url;
  input.form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  return input;
};

it('shows #VALUE! with the refusal for an IMPORT formula pointed at a private address', async () => {
  const { wb, id } = await mount();
  P.fetchText.mockRejectedValue(refusal('http://localhost:8080/data.csv'));
  wb.setInput(id, 0, 0, '=IMPORTDATA("http://localhost:8080/data.csv")');
  wb.getValue(id, 0, 0);
  await vi.advanceTimersByTimeAsync(20);
  expect(wb.getValue(id, 0, 0)).toMatchObject({ error: '#VALUE!', message: expect.stringMatching(/only addresses on the public internet/) });
  expect(view.el.querySelector('.status-error').textContent).toMatch(/Cannot fetch http:\/\/localhost:8080\/data.csv/);
});

it('names the refusal when a file imported from a URL is not on the public internet', async () => {
  await mount();
  P.fetchBytes.mockRejectedValue(refusal('http://192.168.1.5/report.xlsx'));
  const toast = vi.spyOn(notifications, 'toast');
  view.el.querySelector('[data-menu="file"]').click();
  menuItem('Import').click();
  menuItem('From a URL…').click();
  await vi.advanceTimersByTimeAsync(1);
  submitUrl('Import from URL', 'http://192.168.1.5/report.xlsx');
  await vi.advanceTimersByTimeAsync(5);
  expect(P.fetchBytes).toHaveBeenCalledWith('http://192.168.1.5/report.xlsx');
  expect(toast).toHaveBeenCalledWith(expect.stringMatching(/only addresses on the public internet/), expect.objectContaining({ icon: 'alert' }));
  expect(toast).not.toHaveBeenCalledWith('Could not fetch or read that file', expect.anything());
});

it('names the refusal when an image from a URL is not on the public internet', async () => {
  await mount();
  P.fetchBytes.mockRejectedValue(refusal('http://intranet.local/logo.png'));
  const toast = vi.spyOn(notifications, 'toast');
  view.el.querySelector('[data-menu="insert"]').click();
  menuItem('Image').click();
  menuItem('From a URL…').click();
  await vi.advanceTimersByTimeAsync(1);
  submitUrl('Insert image from URL', 'http://intranet.local/logo.png');
  await vi.advanceTimersByTimeAsync(5);
  expect(toast).toHaveBeenCalledWith(expect.stringMatching(/only addresses on the public internet/), expect.objectContaining({ icon: 'alert' }));
  expect(toast).not.toHaveBeenCalledWith('Could not fetch that image', expect.anything());
});

it('refuses a private address in the URL dialogs before fetching when the helper can tell', async () => {
  await mount();
  P.isPublicHttpUrl.mockImplementation((url) => !/localhost/.test(url));
  view.el.querySelector('[data-menu="file"]').click();
  menuItem('Import').click();
  menuItem('From a URL…').click();
  await vi.advanceTimersByTimeAsync(1);
  const input = submitUrl('Import from URL', 'http://localhost/data.csv');
  await vi.advanceTimersByTimeAsync(5);
  expect(P.fetchBytes).not.toHaveBeenCalled();
  expect(input.isConnected).toBe(true); // the dialog stays open on the refused address
  const error = document.querySelector('.modal-panel[aria-label="Import from URL"] .field-error');
  expect(error.hidden).toBe(false);
  expect(error.textContent).toMatch(/public internet/);
});
