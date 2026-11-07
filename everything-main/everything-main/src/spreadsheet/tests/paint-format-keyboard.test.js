// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import * as notifications from '../src/ui/toast.js';

// The format painter only listened for a pointer release: armed from the
// keyboard and moved to the target with the arrows, nothing could apply it,
// and running the command again put it away instead.
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

async function mount() {
  const doc = new Doc({ name: 'Paint', path: 'Spreadsheets/Paint.xlsx' });
  const wb = doc.wb;
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, 'Title');
  wb.applyStyle(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, { bold: true, bg: '#ffff00' });
  for (let r = 1; r < 4; r++) wb.setInput(id, r, 0, `row ${r}`);
  view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
  document.querySelector('#app').append(view.el);
  await vi.advanceTimersByTimeAsync(1);
  const viewport = view.el.querySelector('.grid-viewport');
  viewport.focus();
  return { wb, id, viewport };
}
const menuItem = (label) => [...document.querySelectorAll('.menu-item')].find((n) => n.querySelector('.menu-label')?.textContent === label);
const paintFormat = () => { view.el.querySelector('[data-menu="format"]').click(); menuItem('Paint format').click(); };
const key = (viewport, k) => viewport.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
const painting = () => view.el.querySelector('.grid').classList.contains('painting');

it('paints the cells moved to with the keyboard when the command runs again', async () => {
  const { wb, id, viewport } = await mount();
  paintFormat();
  await vi.advanceTimersByTimeAsync(1);
  expect(painting()).toBe(true);
  key(viewport, 'ArrowDown');
  key(viewport, 'ArrowDown');
  paintFormat();
  await vi.advanceTimersByTimeAsync(1);
  expect(wb.getCell(id, 2, 0).s).toMatchObject({ bold: true, bg: '#ffff00' });
  expect(wb.getCell(id, 1, 0)?.s?.bold).toBeUndefined();
  expect(painting()).toBe(false);
  expect(viewport.getAttribute('aria-activedescendant')).toBe('gc-2-0');
});

it('does not claim to have painted when the sheet refuses the formatting', async () => {
  const { wb, id, viewport } = await mount();
  paintFormat();
  await vi.advanceTimersByTimeAsync(1);
  wb.setSheetProtected(id, true);
  const toast = vi.spyOn(notifications, 'toast');
  key(viewport, 'ArrowDown');
  key(viewport, 'ArrowDown');
  key(viewport, 'Enter');
  await vi.advanceTimersByTimeAsync(1);
  expect(wb.getCell(id, 2, 0)?.s?.bold).toBeUndefined();
  expect(toast).not.toHaveBeenCalledWith('Formatting painted', expect.anything());
  expect(toast).toHaveBeenCalledWith(expect.stringMatching(/protected/), expect.objectContaining({ icon: 'lock' }));
  expect(painting()).toBe(false);
});

it('paints on Enter without moving the selection down, and Enter on the source still moves', async () => {
  const { wb, id, viewport } = await mount();
  paintFormat();
  await vi.advanceTimersByTimeAsync(1);
  // Enter while still on the copied cells is ordinary navigation.
  key(viewport, 'Enter');
  await vi.advanceTimersByTimeAsync(1);
  expect(painting()).toBe(true);
  expect(viewport.getAttribute('aria-activedescendant')).toBe('gc-1-0');
  key(viewport, 'ArrowDown');
  key(viewport, 'Enter');
  await vi.advanceTimersByTimeAsync(1);
  expect(wb.getCell(id, 2, 0).s).toMatchObject({ bold: true, bg: '#ffff00' });
  expect(wb.getCell(id, 1, 0)?.s?.bold).toBeUndefined();
  expect(wb.getCell(id, 3, 0)?.s?.bold).toBeUndefined();
  expect(painting()).toBe(false);
  expect(viewport.getAttribute('aria-activedescendant')).toBe('gc-2-0');
  // With the painter away, Enter moves again.
  key(viewport, 'Enter');
  await vi.advanceTimersByTimeAsync(1);
  expect(viewport.getAttribute('aria-activedescendant')).toBe('gc-3-0');
});

it('still puts the painter away when run again on the source, and Escape cancels it', async () => {
  const { wb, id, viewport } = await mount();
  paintFormat();
  await vi.advanceTimersByTimeAsync(1);
  paintFormat();
  await vi.advanceTimersByTimeAsync(1);
  expect(painting()).toBe(false);
  paintFormat();
  await vi.advanceTimersByTimeAsync(1);
  key(viewport, 'ArrowDown');
  key(viewport, 'Escape');
  expect(painting()).toBe(false);
  key(viewport, 'Enter');
  expect(wb.getCell(id, 1, 0)?.s?.bold).toBeUndefined();
  expect(wb.getCell(id, 2, 0)?.s?.bold).toBeUndefined();
});

it('replaces inherited target formatting when applying the painter with Enter', async () => {
  const { wb, id, viewport } = await mount();
  wb.applyStyle(id, { r1: 0, c1: 1, r2: wb.activeSheet.rows - 1, c2: 1 },
    { italic: true, fmt: 'currency', cur: 'USD', bb: true, bs: 'double' });
  wb.setInput(id, 0, 1, '=2*9'); wb.clearHistory();
  paintFormat(); await vi.advanceTimersByTimeAsync(1);
  key(viewport, 'ArrowRight'); await vi.advanceTimersByTimeAsync(1);
  const before = wb.toJSON();
  key(viewport, 'Enter'); await vi.advanceTimersByTimeAsync(1);
  expect(wb.styleAt(id, 0, 1)).toMatchObject({ bold: true, bg: '#ffff00', italic: null, fmt: null, cur: null, bb: null, bs: null });
  expect(wb.getCell(id, 0, 1).f).toBe('2*9'); expect(wb.getValue(id, 0, 1)).toBe(18);
  expect(painting()).toBe(false);
  wb.undo(); expect(wb.toJSON()).toEqual(before);
});
