// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';

// More and Fewer decimal places wrote the active cell's number format onto every selected cell, so a
// currency cell at the top turned the percentages, dates and plain numbers under it into currency.
// Each cell now steps its own decimals and keeps its own format; General cells become Number, and a
// date, time, text or custom code is left alone.
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

async function setup(texts, selection) {
  const doc = new Doc({ name: 'Decimals', path: 'Spreadsheets/Decimals.xlsx' });
  const wb = doc.wb;
  const id = wb.activeSheetId;
  texts.forEach((t, r) => wb.setInput(id, r, 0, t));
  wb.clearHistory();
  view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
  document.querySelector('#app').append(view.el);
  await vi.advanceTimersByTimeAsync(1);
  view.goTo(`Sheet1!${selection}`);
  await vi.advanceTimersByTimeAsync(1);
  const click = (label) => { view.el.querySelector(`[aria-label="${label}"]`).click(); return vi.advanceTimersByTimeAsync(1); };
  const styles = () => texts.map((_, r) => { const s = wb.getCell(id, r, 0)?.s || {}; return [s.fmt ?? null, s.dec ?? null]; });
  const shown = () => texts.map((_, r) => wb.getDisplay(id, r, 0));
  return { wb, id, click, styles, shown };
}

it('steps each selected cell\'s own format by one place, making General cells Number and leaving dates alone', async () => {
  const { wb, click, styles, shown } = await setup(['$5', '10%', '2026-01-05', '7'], 'A1:A4');
  // A typed $5 shows the places it was typed with, none, and carries that zero, as 10% carries its own.
  expect(styles()).toEqual([['currency', 0], ['percent', 0], ['date', null], [null, null]]);
  const date = shown()[2];
  expect(shown()).toEqual(['$5', '10%', date, '7']);
  await click('More decimal places');
  expect(styles()).toEqual([['currency', 1], ['percent', 1], ['date', null], ['number', 1]]);
  expect(shown()).toEqual(['$5.0', '10.0%', date, '7.0']);
  await click('More decimal places');
  expect(styles()).toEqual([['currency', 2], ['percent', 2], ['date', null], ['number', 2]]);
  await click('Fewer decimal places');
  expect(styles()).toEqual([['currency', 1], ['percent', 1], ['date', null], ['number', 1]]);
  // One undo step per click, values untouched.
  wb.undo();
  wb.undo();
  wb.undo();
  expect(styles()).toEqual([['currency', 0], ['percent', 0], ['date', null], [null, null]]);
  expect(wb.canUndo()).toBe(false);
  expect(wb.getValue(wb.activeSheetId, 3, 0)).toBe(7);
});

it('keeps a cell\'s other style and stops at zero places without recording a change', async () => {
  const { wb, id, click, styles } = await setup(['1.5', '2'], 'A1:A2');
  wb.applyStyle(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, { bold: true, fmt: 'number', dec: 0 });
  wb.clearHistory();
  await click('Fewer decimal places');
  // A1 was at zero already; A2 (General, showing a whole number) has nothing to drop and only takes Number.
  expect(styles()).toEqual([['number', 0], ['number', 0]]);
  expect(wb.getCell(id, 0, 0).s.bold).toBe(true);
  expect(wb.undoLabels()).toHaveLength(1);
});

// An Automatic cell used to step from a phantom two places, so Fewer decimal places turned 2 and 7 into
// "2.0" and "7.0" — a command whose whole purpose is to remove a place added one — and More jumped to
// three. Each Automatic cell now steps from the places it actually prints.
it('steps an Automatic cell from the places it shows, so Fewer never adds one', async () => {
  const { click, styles, shown } = await setup(['2', '7', '1.5'], 'A1:A3');
  await click('Fewer decimal places');
  expect(shown()).toEqual(['2', '7', '2']);
  expect(styles()).toEqual([['number', 0], ['number', 0], ['number', 0]]);
});

it('adds one place to the places an Automatic cell shows, not two', async () => {
  const { click, styles, shown } = await setup(['2', '7', '1.5'], 'A1:A3');
  await click('More decimal places');
  expect(shown()).toEqual(['2.0', '7.0', '1.50']);
  expect(styles()).toEqual([['number', 1], ['number', 1], ['number', 2]]);
});
