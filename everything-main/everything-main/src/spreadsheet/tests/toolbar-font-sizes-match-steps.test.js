// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createToolbar, FONT_SIZES, POINT_SIZES } from '../src/ui/toolbar.js';
import { closeMenu } from '../src/ui/menu.js';
import { closeAllModals } from '../src/ui/modal.js';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { Workbook } from '../src/core/workbook.js';

// Larger font stepped along a list that ran to 48 while the size menu's list stopped at 36 (and started at
// 9 where the steps started at 8), so after a step the menu showed the size in its button with no item checked.
function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() };
}
Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true });

const checkedSizes = () => [...document.querySelectorAll('[role="menuitemradio"][aria-checked="true"]')].map((b) => b.querySelector('.menu-label').textContent);

describe('the size menu', () => {
  afterEach(() => { closeMenu(); document.body.replaceChildren(); });

  // Sizes are stored in pixels and shown in points.
  it.each([8, 48, 10.5, 22, 9.75])('offers and checks %s points', (size) => {
    const wb = new Workbook();
    const toolbar = createToolbar({
      wb, run() {}, activeCell: () => null, style: () => ({ size: size * 4 / 3 }), active: () => ({ r: 0, c: 0 }),
      range: () => ({ r1: 0, c1: 0, r2: 0, c2: 0 }), sheetId: () => wb.activeSheetId, grid: { editing: false }, subscribe: () => () => {},
    });
    document.body.append(toolbar.el);
    expect(toolbar.el.querySelector('.tb-size-label').textContent).toBe(String(size));
    toolbar.el.querySelector('.tb-size').click();
    expect(checkedSizes()).toEqual([String(size)]);
    expect(document.activeElement.getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement.querySelector('.menu-label').textContent).toBe(String(size));
  });
});

it('names the theme body font and shows its size in points', () => {
  const wb = new Workbook();
  const toolbar = createToolbar({
    wb, run() {}, activeCell: () => null, style: () => ({ font: 'calibri', scheme: 'minor', size: 11 * 4 / 3 }), active: () => ({ r: 0, c: 0 }),
    range: () => ({ r1: 0, c1: 0, r2: 0, c2: 0 }), sheetId: () => wb.activeSheetId, grid: { editing: false }, subscribe: () => () => {},
  });
  document.body.append(toolbar.el);
  toolbar.refresh();
  expect(toolbar.el.querySelector('.tb-font-label').textContent).toBe('Calibri (Body)');
  expect(toolbar.el.querySelector('.tb-size-label').textContent).toBe('11');
  document.body.replaceChildren();
});

describe('stepping the size in the editor', () => {
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
  afterEach(() => { closeMenu(); closeAllModals(); view?.destroy(); view = null; vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

  it('lands on a size the menu offers at every step, from the smallest to the largest, with that item checked', async () => {
    const doc = new Doc({ name: 'Sizes', path: 'Spreadsheets/Sizes.xlsx' });
    const { wb } = doc;
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, 'x');
    view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
    document.querySelector('#app').append(view.el);
    await vi.advanceTimersByTimeAsync(5);
    const menubarItem = (label) => [...document.querySelectorAll('.menu-item')].find((n) => n.querySelector('.menu-label')?.textContent === label);
    const step = async (dir) => {
      view.el.querySelector('[data-menu="format"]').click();
      menubarItem('Text').click();
      menubarItem(dir > 0 ? 'Larger font' : 'Smaller font').click();
      await vi.advanceTimersByTimeAsync(5);
      return wb.getCell(id, 0, 0)?.s?.size ?? 13;
    };
    const reached = [];
    // Down to the smallest, then up to the largest.
    for (let size = 13, next = await step(-1); next !== size; size = next, next = await step(-1)) reached.push(next);
    expect(reached.at(-1)).toBe(FONT_SIZES[0]);
    for (let size = reached.at(-1), next = await step(1); next !== size; size = next, next = await step(1)) reached.push(next);
    expect(reached.at(-1)).toBe(FONT_SIZES.at(-1));
    for (const size of reached) expect(FONT_SIZES, `size ${size}`).toContain(size);
    // The menu checks the size the steps ended on.
    view.el.querySelector('.tb-size').click();
    expect(checkedSizes()).toEqual([String(POINT_SIZES.at(-1))]);
  });
});
