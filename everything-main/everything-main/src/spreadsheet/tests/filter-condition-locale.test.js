// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { getLocale, setLocale } from '../src/core/format.js';
import { isMenuOpen } from '../src/ui/menu.js';

// The column filter's condition box read its values with Number(), so under a comma-decimal regional
// format 1,5 was refused ("This condition needs numbers"), and in en-US so were 1,000, 10% and a date,
// while Equal to 12.5% on a cell showing 12.50% hid every row. The values are read as a typed entry is,
// in the regional format, as the conditional-formatting dialog reads its own, and the number is stored.
function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() };
}
Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true });

let view;
let previousLocale;
beforeEach(() => {
  previousLocale = getLocale();
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
afterEach(() => { setLocale(previousLocale); view?.destroy(); view = null; vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

/** A filtered column A with a header and the given typed entries under it (a view mounted before goes first). */
async function mount(locale, entries) {
  view?.destroy();
  view = null;
  document.body.innerHTML = '<div id="app"></div>';
  setLocale(locale);
  const doc = new Doc({ name: 'List', path: 'Spreadsheets/List.xlsx' });
  const wb = doc.wb;
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, 'Amount');
  entries.forEach((text, i) => wb.setInput(id, i + 1, 0, text));
  wb.setFilterRange(id, { r1: 0, c1: 0, r2: entries.length, c2: 0 });
  view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
  document.querySelector('#app').append(view.el);
  await vi.advanceTimersByTimeAsync(1);
  return { wb, id };
}
async function openFilter() {
  const viewport = view.el.querySelector('.grid-viewport');
  viewport.focus();
  viewport.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true, cancelable: true }));
  await vi.advanceTimersByTimeAsync(1);
  expect(isMenuOpen()).toBe(true);
}
const field = (label) => document.querySelector(`.menu [aria-label="${label}"]`);
async function condition(op, value, value2 = null) {
  const select = field('Condition');
  select.value = op;
  select.dispatchEvent(new Event('change'));
  field('Condition value').value = value;
  if (value2 != null) field('Second value').value = value2;
  [...document.querySelectorAll('.menu button')].find((b) => b.textContent === 'Apply').click();
  await vi.advanceTimersByTimeAsync(1);
}
const error = () => document.querySelector('.menu .field-error:not([hidden])')?.textContent ?? null;
const hidden = (wb, id) => [...wb.sheet(id).filterHidden].sort((a, b) => a - b);
const stored = (wb, id) => wb.sheet(id).filter.criteria[0];

it('reads 1,5 as one and a half under a comma-decimal regional format, and stores the number', async () => {
  const { wb, id } = await mount('de-DE', ['1', '2', '3']);
  await openFilter();
  await condition('gt', '1,5');
  expect(error()).toBeNull();
  expect(isMenuOpen()).toBe(false);
  expect(stored(wb, id)).toMatchObject({ op: 'gt', value: 1.5 });
  expect(hidden(wb, id)).toEqual([1]);
  await openFilter();
  await condition('between', '1,5', '2,5');
  expect(stored(wb, id)).toMatchObject({ op: 'between', value: 1.5, value2: 2.5 });
  expect(hidden(wb, id)).toEqual([1, 3]);
});

it('reads a thousands separator, a percentage and a date in en-US as a typed entry reads them', async () => {
  const { wb, id } = await mount('en-US', ['500', '1500', '2500']);
  await openFilter();
  await condition('gt', '1,000');
  expect(error()).toBeNull();
  expect(stored(wb, id)).toMatchObject({ value: 1000 });
  expect(hidden(wb, id)).toEqual([1]);
  const shares = await mount('en-US', ['5%', '20%', '12.5%']);
  await openFilter();
  await condition('lt', '10%');
  expect(stored(shares.wb, shares.id)).toMatchObject({ value: 0.1 });
  expect(hidden(shares.wb, shares.id)).toEqual([2, 3]);
  // Equal to 12.5% meets the cell that shows 12.50%, rather than hiding every row.
  await openFilter();
  await condition('eq', '12.5%');
  expect(stored(shares.wb, shares.id)).toMatchObject({ op: 'eq', value: 0.125 });
  expect(hidden(shares.wb, shares.id)).toEqual([1, 2]);
  const dates = await mount('en-US', ['2024-01-14', '2024-01-15', '2024-01-16']);
  await openFilter();
  await condition('gte', '2024-01-15');
  expect(error()).toBeNull();
  expect(hidden(dates.wb, dates.id)).toEqual([1]);
});

it('still refuses text where a number is needed, and keeps Equal to text as text', async () => {
  const { wb, id } = await mount('en-US', ['pear', 'apple', '7']);
  await openFilter();
  await condition('gt', 'abc');
  expect(error()).toBe('This condition needs numbers');
  await condition('eq', 'apple');
  expect(stored(wb, id)).toMatchObject({ op: 'eq', value: 'apple' });
  expect(hidden(wb, id)).toEqual([1, 3]);
});
