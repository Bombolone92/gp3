// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import * as P from '../src/lib/puter.js';
import * as notifications from '../src/ui/toast.js';
import { closeMenu } from '../src/ui/menu.js';

// The selection-as-CSV and chart exports download to this device inside the Puter app, as the sheet
// exports do: Puter's save dialog put them in the user's Puter files instead.
vi.mock('../src/lib/puter.js', async (importOriginal) => ({
  ...(await importOriginal()),
  isApp: () => true,
  canSaveFiles: () => true,
  saveFileAs: vi.fn(),
  downloadBlob: vi.fn(),
}));

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
  P.saveFileAs.mockReset();
  P.downloadBlob.mockReset();
});
afterEach(() => { closeMenu(); view?.destroy(); view = null; vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

const menuItem = (test) => [...document.querySelectorAll('.menu-item')].find((n) => test(n.querySelector('.menu-label')?.textContent || ''));

async function mount() {
  const doc = new Doc({ name: 'Report', path: 'Spreadsheets/Report.xlsx' });
  const { wb } = doc;
  const id = wb.activeSheetId;
  [['Item', 'Qty'], ['a', '1'], ['b', '2']].forEach((row, r) => row.forEach((t, c) => wb.setInput(id, r, c, t)));
  const chartId = wb.addChart(id, { type: 'bar', range: { r1: 0, c1: 0, r2: 2, c2: 1 }, anchor: { r: 4, c: 0 }, w: 320, h: 200, title: 'Quantities' });
  expect(chartId).toBeTruthy();
  view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
  document.querySelector('#app').append(view.el);
  await vi.advanceTimersByTimeAsync(1);
  return { wb, id, chartId, toast: vi.spyOn(notifications, 'toast') };
}

it('downloads the selection as CSV', async () => {
  await mount();
  view.goTo('Sheet1!A1:B3');
  await vi.advanceTimersByTimeAsync(1);
  view.el.querySelector('[data-menu="file"]').click();
  menuItem((label) => label === 'Export').click();
  menuItem((label) => label === 'Selection as .csv').click();
  await vi.advanceTimersByTimeAsync(5);
  expect(P.saveFileAs).not.toHaveBeenCalled();
  expect(P.downloadBlob).toHaveBeenCalledTimes(1);
  expect(P.downloadBlob.mock.calls[0][1]).toBe('Report - A1-B3.csv');
});

it('downloads a chart', async () => {
  const { chartId } = await mount();
  const box = view.el.querySelector(`.chart-box[data-chart="${chartId}"]`);
  expect(box).not.toBeNull();
  box.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 200, clientY: 200 }));
  await vi.advanceTimersByTimeAsync(1);
  menuItem((label) => label === 'Download as SVG').click();
  await vi.advanceTimersByTimeAsync(5);
  expect(P.saveFileAs).not.toHaveBeenCalled();
  expect(P.downloadBlob).toHaveBeenCalledTimes(1);
  expect(P.downloadBlob.mock.calls[0][1]).toBe('Quantities.svg');
});

it('keeps imported image mirroring when downloading the picture', async () => {
  const { wb, id } = await mount();
  const ctx = { translate: vi.fn(), scale: vi.fn(), drawImage: vi.fn(), measureText: t => ({ width: t.length * 7 }) };
  vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(ctx);
  const png = new Blob(['rendered'], { type: 'image/png' });
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (done) { done(png); });
  vi.stubGlobal('Image', class {
    naturalWidth = 600;
    naturalHeight = 240;
    set src(value) { queueMicrotask(() => this.onload()); }
  });
  const imageId = wb.addChart(id, { type: 'image', src: 'data:image/png;base64,AAAA', title: 'Artwork', anchor: { r: 0, c: 3 }, w: 600, h: 240, flipH: true });
  await vi.advanceTimersByTimeAsync(1);
  view.el.querySelector(`[data-chart="${imageId}"]`).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 200, clientY: 200 }));
  await vi.advanceTimersByTimeAsync(1);
  menuItem(label => label === 'Download image').click();
  await vi.advanceTimersByTimeAsync(5);
  expect(ctx.translate).toHaveBeenCalledWith(600, 0);
  expect(ctx.scale).toHaveBeenCalledWith(-1, 1);
  expect(ctx.drawImage).toHaveBeenCalledTimes(1);
  expect(P.downloadBlob).toHaveBeenCalledWith(png, 'Artwork.png');
});
