// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { closeMenu } from '../src/ui/menu.js';
import { closeAllModals } from '../src/ui/modal.js';
import { Workbook } from '../src/core/workbook.js';
import { fillSeriesLines, justifyLines, refill, trendFit } from '../src/core/autofill-options.js';
import { parseRange } from '../src/core/cell.js';

// The Auto Fill Options after a fill-handle drag (Copy Cells, Fill Series, Fill Formatting Only,
// Fill Without Formatting, the date units, Flash Fill), Fill ▸ Justify and the Series dialog's AutoFill,
// Trend and every-line fills.
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
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 400 });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ measureText: (t) => ({ width: t.length * 7 }), font: '' });
  document.body.innerHTML = '<div id="app"></div>';
});
afterEach(() => { closeMenu(); closeAllModals(); view?.destroy(); view = null; vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

async function mount(prep) {
  const doc = new Doc({ name: 'Fill', path: 'Spreadsheets/Fill.xlsx' });
  const { wb } = doc;
  const id = wb.activeSheetId;
  prep?.(wb, id);
  wb.clearHistory();
  view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
  document.querySelector('#app').append(view.el);
  await vi.advanceTimersByTimeAsync(1);
  const viewport = view.el.querySelector('.grid-viewport');
  viewport.focus();
  const at = async (a) => { view.goTo(`Sheet1!${a}`); await vi.advanceTimersByTimeAsync(1); };
  const pointer = (target, type, x, y) => target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, button: 0, pointerType: 'mouse' }));
  /** Drag the fill handle of the selection `from` down to the row under `y` (pixels from the top of the cells). */
  const dragDown = async (from, y) => {
    await at(from);
    const handle = view.el.querySelector('.fill-handle');
    pointer(handle, 'pointerdown', 99, 25);
    pointer(viewport, 'pointermove', 50, y);
    pointer(viewport, 'pointerup', 50, y);
    await vi.advanceTimersByTimeAsync(5);
  };
  const button = () => view.el.querySelector('.option-button');
  const menuItem = (label) => [...document.querySelectorAll('.menu [role^="menuitem"]')].find((b) => b.querySelector('.menu-label')?.firstChild?.textContent === label);
  const choose = async (label) => { button().click(); await vi.advanceTimersByTimeAsync(5); menuItem(label).click(); await vi.advanceTimersByTimeAsync(5); };
  const column = (n, c = 0) => Array.from({ length: n }, (_, r) => wb.getValue(id, r, c));
  return { wb, id, viewport, at, dragDown, button, menuItem, choose, column };
}

describe('the Auto Fill Options button', () => {
  it('appears after a fill-handle drag, and Fill Series counts on where the drag copied, as one step', async () => {
    const { wb, button, menuItem, dragDown, column, choose } = await mount((wb, id) => wb.setInput(id, 0, 0, '1'));
    await dragDown('A1', 90);
    const n = column(10).filter((v) => v != null).length;
    expect(n).toBeGreaterThan(2);
    expect(column(n)).toEqual(Array(n).fill(1));
    expect(button().hidden).toBe(false);
    expect(button().getAttribute('aria-label')).toBe('Auto Fill Options (Ctrl)');
    button().click(); await vi.advanceTimersByTimeAsync(5);
    const labels = [...document.querySelectorAll('.menu [role^="menuitem"] .menu-label')].map((x) => x.firstChild?.textContent);
    expect(labels).toEqual(['Copy Cells', 'Fill Series', 'Fill Formatting Only', 'Fill Without Formatting']);
    expect(menuItem('Copy Cells').getAttribute('aria-checked')).toBe('true');
    closeMenu();
    await choose('Fill Series');
    expect(column(n)).toEqual(Array.from({ length: n }, (_, i) => i + 1));
    expect(wb.undoLabels(9)).toHaveLength(1);
    await choose('Copy Cells');
    expect(column(n)).toEqual(Array(n).fill(1));
    expect(wb.undoLabels(9)).toHaveLength(1);
    wb.undo();
    expect(column(3)).toEqual([1, null, null]);
    expect(button().hidden).toBe(true);
  });

  it('fills dates by days, weekdays, months or years', async () => {
    const { wb, id, dragDown, column, choose, menuItem, button } = await mount((wb, id) => {
      wb.setInput(id, 0, 0, '2024-01-31'); // a Wednesday
    });
    await dragDown('A1', 90);
    const n = column(10).filter((v) => v != null).length;
    button().click(); await vi.advanceTimersByTimeAsync(5);
    expect(['Fill Days', 'Fill Weekdays', 'Fill Months', 'Fill Years'].every((l) => menuItem(l))).toBe(true);
    expect(menuItem('Flash Fill')).toBeFalsy();
    closeMenu();
    await choose('Fill Months');
    // 31 January, then 29 February (2024 is a leap year) and 31 March: the day held where the month has it.
    const months = column(3);
    expect([months[1] - months[0], months[2] - months[1]]).toEqual([29, 31]);
    await choose('Fill Weekdays');
    // Wednesday 31 Jan, then Thursday, Friday, and Monday 5 Feb.
    const serial = column(4);
    expect([serial[1] - serial[0], serial[2] - serial[1], serial[3] - serial[2]]).toEqual([1, 1, 3]);
    await choose('Fill Years');
    const years = column(3);
    expect(years[1] - years[0]).toBe(366);
  });

  it('fills formatting only, or contents without formatting', async () => {
    const { wb, id, dragDown, choose, column } = await mount((wb, id) => {
      wb.setInput(id, 0, 0, '1');
      wb.applyStyle(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, { bold: true });
      for (let r = 1; r < 12; r++) wb.setInput(id, r, 0, String(r + 10));
      wb.applyStyle(id, { r1: 1, c1: 0, r2: 11, c2: 0 }, { italic: true });
    });
    await dragDown('A1', 90);
    const n = [...Array(12).keys()].filter((r) => wb.getValue(id, r, 0) === 1).length;
    expect(n).toBeGreaterThan(2);
    await choose('Fill Formatting Only');
    expect(column(n).slice(1)).toEqual(Array.from({ length: n - 1 }, (_, i) => i + 11));
    expect(wb.styleAt(id, 1, 0).bold).toBe(true);
    await choose('Fill Without Formatting');
    expect(column(n).slice(1)).toEqual(Array(n - 1).fill(1));
    expect(wb.styleAt(id, 1, 0)).toMatchObject({ italic: true });
    expect(wb.styleAt(id, 1, 0).bold).toBeFalsy();
    expect(wb.undoLabels(9)).toHaveLength(1);
  });

  it('offers Flash Fill for text, which fills from the pattern beside it', async () => {
    const { wb, id, dragDown, choose } = await mount((wb, id) => {
      [['Ada Lovelace', 'Ada'], ['Alan Turing', null], ['Grace Hopper', null], ['Edsger Dijkstra', null], ['Barbara Liskov', null], ['Donald Knuth', null]]
        .forEach(([a, b], r) => { wb.setInput(id, r, 0, a); if (b) wb.setInput(id, r, 1, b); });
    });
    await dragDown('B1', 90);
    expect(wb.getValue(id, 1, 1)).toBe('Ada');
    await choose('Flash Fill');
    expect(wb.getValue(id, 1, 1)).toBe('Alan');
    expect(wb.getValue(id, 2, 1)).toBe('Grace');
  });
});

describe('Fill ▸ Justify', () => {
  it('rejoins the column\'s text into lines as wide as the column, from the menus', async () => {
    const { wb, id, at, column } = await mount((wb, id) => {
      wb.setColWidth(id, 0, 100);
      wb.setInput(id, 0, 0, 'The quick brown');
      wb.setInput(id, 1, 0, 'fox jumps over the lazy dog');
    });
    await at('A1:A2');
    const item = (name) => [...document.querySelectorAll('.menu-item')].find((b) => b.querySelector('.menu-label')?.textContent === name);
    view.el.querySelector('[data-menu="edit"]').click();
    item('Fill').click();
    item('Justify').click();
    await vi.advanceTimersByTimeAsync(5);
    expect(column(5)).toEqual(['The quick', 'brown fox', 'jumps over', 'the lazy dog', null]);
    expect(wb.undoLabels(9)).toEqual(['Justify']);
    wb.undo();
    expect(column(3)).toEqual(['The quick brown', 'fox jumps over the lazy dog', null]);
  });

  it('breaks lines by width and keeps blank-separated paragraphs apart', () => {
    const measure = (t) => t.length;
    expect(justifyLines(['a b c', null, 'd e'], 3, measure)).toEqual(['a b', 'c', '', 'd e']);
    expect(justifyLines(['one two', 'three'], 100, measure)).toEqual(['one two three']);
    expect(justifyLines(['enormousword x'], 4, measure)).toEqual(['enormousword', 'x']);
  });
});

describe('the Series dialog\'s AutoFill, Trend and every-line fills', () => {
  const book = (cells) => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    for (const [ref, text] of Object.entries(cells)) { const g = parseRange(ref); wb.setInput(id, g.r1, g.c1, text); }
    wb.clearHistory();
    return { wb, id, col: (c, n) => Array.from({ length: n }, (_, r) => wb.getValue(id, r, c)) };
  };

  it('fills every column of the selection from its own first cell, as one step', () => {
    const { wb, id, col } = book({ A1: '1', B1: '10' });
    expect(fillSeriesLines(wb, id, parseRange('A1:B4'), { step: 2, direction: 'down' })).toBe(6);
    expect(col(0, 4)).toEqual([1, 3, 5, 7]);
    expect(col(1, 4)).toEqual([10, 12, 14, 16]);
    expect(wb.undoLabels(9)).toHaveLength(1);
  });

  it('AutoFills each line from its leading cells as the fill handle would', () => {
    const { wb, id, col } = book({ A1: 'Mon', B1: '2', B2: '4' });
    fillSeriesLines(wb, id, parseRange('A1:B5'), { type: 'autofill', direction: 'down' });
    expect(col(0, 5)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']);
    expect(col(1, 5)).toEqual([2, 4, 6, 8, 10]);
  });

  it('replaces each line with its best-fit trend, linear or growth', () => {
    const { wb, id, col } = book({ A1: '1', A2: '3', A3: '4', B1: '2', B2: '4' });
    fillSeriesLines(wb, id, parseRange('A1:A5'), { type: 'linear', trend: true, direction: 'down' });
    // TREND through (1, 3, 4): slope 1.5 from 1.1667.
    expect(col(0, 5).map((v) => +v.toFixed(4))).toEqual([1.1667, 2.6667, 4.1667, 5.6667, 7.1667]);
    fillSeriesLines(wb, id, parseRange('B1:B4'), { type: 'growth', trend: true, direction: 'down' });
    expect(col(1, 4)).toEqual([2, 4, 8, 16]);
    expect(trendFit([5])(3)).toBe(5);
  });

  it('refills a restored target as Copy Cells or Fill Series for each line', () => {
    const { wb, id, col } = book({ A1: '1', B1: '1', B2: '3' });
    refill(wb, id, parseRange('A1:B2'), parseRange('A1:B4'), 'series');
    expect(col(0, 4)).toEqual([1, null, 1, null]);
    expect(col(1, 4)).toEqual([1, 3, 5, 7]);
    refill(wb, id, parseRange('B1:B2'), parseRange('B1:B4'), 'copy');
    expect(col(1, 4)).toEqual([1, 3, 1, 3]);
  });
});
