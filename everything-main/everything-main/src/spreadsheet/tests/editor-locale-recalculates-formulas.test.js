// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { setLocale } from '../src/core/format.js';
import { memoryStorage } from './helpers/memory-storage.js';

// Switching the regional format redrew the grid but kept the calculation cache, so a cell showed 1.234,50 while
// =TEXT(A1,"#,##0.00") beside it went on showing 1,234.50, the answer computed under the old format, until some
// edit recalculated it; F9 did not either, since it refreshed only the volatile formulas and the async answers.
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
afterEach(() => { setLocale('en-US'); view?.destroy(); view = null; vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

/** A1 holds 1234.5 and A2 writes it through TEXT, both computed and drawn under en-US. */
async function mount() {
  const doc = new Doc({ name: 'Budget', path: 'Spreadsheets/Budget.xlsx' });
  const wb = doc.wb;
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '1234.5');
  wb.setInput(id, 1, 0, '=TEXT(A1,"#,##0.00")');
  view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
  document.querySelector('#app').append(view.el);
  await vi.advanceTimersByTimeAsync(50);
  const shown = (r) => view.el.querySelector(`#gc-${r}-0`).textContent;
  expect([shown(0), shown(1)]).toEqual(['1234.5', '1,234.50']);
  return { doc, wb, id, shown };
}

it('recalculates a formula whose result is written in the regional format when the format is switched', async () => {
  const { doc, wb, id, shown } = await mount();
  const dirty = wb.dirty;
  const status = doc.status;
  const history = wb.undoLabels(100);
  setLocale('de-DE');
  window.dispatchEvent(new CustomEvent('app:locale', { detail: { locale: 'de-DE' } }));
  await vi.advanceTimersByTimeAsync(50);
  expect(wb.getDisplay(id, 1, 0)).toBe('1.234,50');
  expect([shown(0), shown(1)]).toEqual(['1234,5', '1.234,50']);
  // A recalculation is not an edit: nothing more to save, nothing more to undo.
  expect(wb.dirty).toBe(dirty);
  expect(doc.status).toBe(status);
  expect(wb.undoLabels(100)).toEqual(history);
  // And back again.
  setLocale('en-US');
  window.dispatchEvent(new CustomEvent('app:locale', { detail: { locale: 'en-US' } }));
  await vi.advanceTimersByTimeAsync(50);
  expect([shown(0), shown(1)]).toEqual(['1234.5', '1,234.50']);
});

it('recalculates every formula on F9, not the volatile ones alone', async () => {
  const { wb, id, shown } = await mount();
  const history = wb.undoLabels(100);
  // The format changed under the sheet without a word (as a stale cache would leave it): F9 catches the formula up.
  setLocale('de-DE');
  expect(wb.getDisplay(id, 1, 0)).toBe('1,234.50');
  view.el.querySelector('.grid-viewport').dispatchEvent(new KeyboardEvent('keydown', { key: 'F9', bubbles: true, cancelable: true }));
  await vi.advanceTimersByTimeAsync(50);
  expect(wb.getDisplay(id, 1, 0)).toBe('1.234,50');
  expect(shown(1)).toBe('1.234,50');
  expect(wb.undoLabels(100)).toEqual(history);
});
