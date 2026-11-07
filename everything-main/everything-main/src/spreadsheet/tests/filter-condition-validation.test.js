// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { isMenuOpen } from '../src/ui/menu.js';

// Filter "by condition" applied whatever was typed: "greater than" with no
// number, or "text contains" with nothing to contain, silently hid every row.
// The conditional formatting dialog refuses the same input with a message.
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
  const doc = new Doc({ name: 'List', path: 'Spreadsheets/List.xlsx' });
  const wb = doc.wb;
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, 'Amount');
  for (let r = 1; r <= 4; r++) wb.setInput(id, r, 0, String(r * 10));
  wb.setFilterRange(id, { r1: 0, c1: 0, r2: 4, c2: 0 });
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

it('refuses a numeric condition without a number and keeps the menu open', async () => {
  const { wb, id } = await mount();
  await openFilter();
  await condition('gt', '');
  expect(isMenuOpen()).toBe(true);
  expect(error()).toBe('Enter a value');
  expect(hidden(wb, id)).toEqual([]);
  await condition('gt', 'abc');
  expect(error()).toBe('This condition needs numbers');
  expect(hidden(wb, id)).toEqual([]);
  await condition('between', '10', '');
  expect(error()).toBe('Enter both values');
  expect(hidden(wb, id)).toEqual([]);
  // Once the value is there the condition applies and the menu closes.
  await condition('gt', '20');
  expect(isMenuOpen()).toBe(false);
  expect(hidden(wb, id)).toEqual([1, 2]);
});

it('refuses a text condition with nothing to look for', async () => {
  const { wb, id } = await mount();
  await openFilter();
  await condition('contains', '');
  expect(isMenuOpen()).toBe(true);
  expect(error()).toBe('Enter a value');
  expect(hidden(wb, id)).toEqual([]);
  await condition('contains', '3');
  expect(isMenuOpen()).toBe(false);
  expect(hidden(wb, id)).toEqual([1, 2, 4]);
});

// The message was said once, but the field it was about was neither marked invalid nor described by it:
// back on the field, a screen reader heard neither that it was refused nor why.
it('marks the refused condition field invalid and described by the message, until it is typed in', async () => {
  await mount();
  await openFilter();
  await condition('gt', 'abc');
  const value = field('Condition value');
  const message = document.querySelector('.menu .field-error:not([hidden])');
  expect(value.getAttribute('aria-invalid')).toBe('true');
  expect(value.getAttribute('aria-describedby')).toBe(message.id);
  expect(document.activeElement).toBe(value);
  value.value = '12';
  value.dispatchEvent(new Event('input', { bubbles: true }));
  expect(error()).toBeNull();
  expect(value.hasAttribute('aria-invalid')).toBe(false);
  expect(value.hasAttribute('aria-describedby')).toBe(false);
  await condition('between', '10', '');
  expect(field('Second value').getAttribute('aria-invalid')).toBe('true');
  expect(value.hasAttribute('aria-invalid')).toBe(false);
});
