// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { closeMenu } from '../src/ui/menu.js';

// Ctrl/Cmd+Shift+% and $, the Format menu's Percent and Currency radio items and the palette's
// "Number format" entries toggled the format off when the active cell already had it, so a mixed
// selection lost its formats instead of taking the one asked for. Only the toolbar's two buttons
// press on and off now; every other caller applies the format and leaves it applied.
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
afterEach(() => { closeMenu(); view?.destroy(); view = null; vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

const item = (label) => [...document.querySelectorAll('.menu-item')].find((n) => n.querySelector('.menu-label')?.textContent === label);

/** A1:A3 selected with A1 active, A1 already in `fmt` and the others plain. */
async function setup(texts) {
  const doc = new Doc({ name: 'Formats', path: 'Spreadsheets/Formats.xlsx' });
  const wb = doc.wb;
  const id = wb.activeSheetId;
  texts.forEach((t, r) => wb.setInput(id, r, 0, t));
  wb.clearHistory();
  view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
  document.querySelector('#app').append(view.el);
  await vi.advanceTimersByTimeAsync(1);
  view.goTo('Sheet1!A1:A3');
  await vi.advanceTimersByTimeAsync(1);
  const viewport = view.el.querySelector('.grid-viewport');
  viewport.focus();
  const formats = () => texts.map((_, r) => wb.getCell(id, r, 0)?.s?.fmt ?? null);
  const chord = (key) => { viewport.dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey: true, metaKey: true, shiftKey: true, bubbles: true, cancelable: true })); return vi.advanceTimersByTimeAsync(1); };
  const menu = async (label) => {
    view.el.querySelector('[data-menu="format"]').click();
    item('Number').click();
    await vi.advanceTimersByTimeAsync(1);
    item(label).click();
    await vi.advanceTimersByTimeAsync(1);
  };
  const palette = async (label) => {
    viewport.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, metaKey: true, shiftKey: true, bubbles: true, cancelable: true }));
    await vi.advanceTimersByTimeAsync(1);
    const input = document.querySelector('.palette-input');
    input.value = label;
    input.dispatchEvent(new Event('input'));
    expect(document.querySelector('.palette-item').textContent).toContain(label);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await vi.advanceTimersByTimeAsync(1);
  };
  // The toolbar has a % toggle but no currency one; the currency case has no button to press.
  const button = view.el.querySelector(`[aria-label="Format as ${texts[0].includes('%') ? 'percent' : 'currency'}"]`);
  const toolbar = button ? () => { button.click(); return vi.advanceTimersByTimeAsync(1); } : null;
  return { wb, id, formats, chord, menu, palette, toolbar };
}

it.each([
  ['percent', ['10%', '0.5', '0.25'], '%', 'Percent'],
  ['currency', ['$5', '7', '12'], '$', 'Currency'],
])('applies %s from the chord, the menu and the palette over a cell already in it, and only the toolbar button toggles it off', async (fmt, texts, key, label) => {
  const { formats, chord, menu, palette, toolbar } = await setup(texts);
  expect(formats()).toEqual([fmt, null, null]);
  await chord(key);
  expect(formats()).toEqual([fmt, fmt, fmt]);
  await chord(key); // pressed again: still applied
  expect(formats()).toEqual([fmt, fmt, fmt]);
  await menu(label); // an already-checked radio item never un-sets its format
  expect(formats()).toEqual([fmt, fmt, fmt]);
  await palette(`Number format: ${label}`);
  expect(formats()).toEqual([fmt, fmt, fmt]);
  // The toolbar button, where there is one (Percent Style), is a press-on, press-off control: it takes the format away, and puts it back.
  if (!toolbar) { expect(fmt).toBe('currency'); return; }
  await toolbar();
  expect(formats()).toEqual([null, null, null]);
  await toolbar();
  expect(formats()).toEqual([fmt, fmt, fmt]);
});
