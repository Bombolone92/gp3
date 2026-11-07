// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { closeMenu } from '../src/ui/menu.js';
import * as notifications from '../src/ui/toast.js';

// Shuffle, change case and split text reported the rows or cells they meant to
// change even when a protected cell had refused the write: "Shuffled 6 rows" over
// rows that had not moved. They now report the refusal, and the editor shows the
// protected notice instead of a success toast.
function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() };
}
Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true });

function book(rows) {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, rows.flatMap((row, r) => row.map((v, c) => ({ r, c, cell: v == null ? null : { v } }))));
  const refusals = [];
  wb.addEventListener('change', (e) => { if (e.detail?.type === 'protected') refusals.push(e.detail.range); });
  return { wb, id, refusals };
}

describe('text tools over a protected range', () => {
  it('shuffle reports no rows moved and leaves the rows alone', () => {
    const { wb, id, refusals } = book([['a', 1], ['b', 2], ['c', 3], ['d', 4], ['e', 5], ['f', 6]]);
    wb.protectRange(id, parseRange('B3'));
    const before = JSON.stringify(wb.toJSON());
    let i = 0;
    expect(wb.shuffleRows(id, parseRange('A1:B6'), { random: () => [0.1, 0.9, 0.3, 0.7, 0.5][i++ % 5] })).toBe(0);
    expect(JSON.stringify(wb.toJSON())).toBe(before);
    expect(refusals).toEqual([parseRange('B3')]);
    expect(wb.rearrangeBlocker(id, parseRange('A1:B6'))).toBe('protected');
  });

  it('change case reports the refusal, apart from a range with no text to change', () => {
    const { wb, id, refusals } = book([['a', 'p'], ['b', 'q'], ['c', 'r'], ['d', 's']]);
    wb.protectRange(id, parseRange('B4'));
    expect(wb.transformText(id, parseRange('A4:B4'), 'upper')).toBe(false);
    expect(wb.getValue(id, 3, 0)).toBe('d');
    expect(refusals).toEqual([parseRange('B4')]);
    expect(wb.transformText(id, parseRange('A1:B3'), 'upper')).toBe(6);
    expect(wb.transformText(id, parseRange('A1:B3'), 'upper')).toBe(0);
  });

  it('split text reports the refusal when a piece would land on a protected cell', () => {
    const { wb, id, refusals } = book([['a,b,c'], ['x']]);
    wb.protectRange(id, parseRange('B1'));
    expect(wb.splitTextToColumns(id, parseRange('A1'))).toEqual({ rows: 0, cols: 0, reason: 'protected' });
    expect(wb.getValue(id, 0, 0)).toBe('a,b,c');
    expect(refusals).toEqual([parseRange('B1')]);
    // Text holding no delimiter writes nothing new, and is reported as nothing split rather than as one column.
    expect(wb.splitTextToColumns(id, parseRange('A2'), ',')).toEqual({ rows: 0, cols: 0 });
  });
});

describe('the editor', () => {
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

  async function mount() {
    const doc = new Doc({ name: 'Locked', path: 'Spreadsheets/Locked.xlsx' });
    const wb = doc.wb;
    const id = wb.activeSheetId;
    for (const [r, a, b] of [[0, 'a,b', 'x'], [1, 'c,d', 'y'], [2, 'e,f', 'z']]) { wb.setInput(id, r, 0, a); wb.setInput(id, r, 1, b); }
    wb.protectRange(id, parseRange('B2'));
    view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
    document.querySelector('#app').append(view.el);
    await vi.advanceTimersByTimeAsync(1);
    const name = view.el.querySelector('[aria-label="Cell reference"]');
    name.value = 'A1:B3';
    name.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await vi.advanceTimersByTimeAsync(1);
    return { wb, id, toast: vi.spyOn(notifications, 'toast'), before: JSON.stringify(wb.toJSON()) };
  }
  const menuItem = (label) => [...document.querySelectorAll('.menu-item')].find((n) => n.querySelector('.menu-label')?.textContent === label);
  async function pick(submenu, label) {
    view.el.querySelector('[data-menu="data"]').click();
    menuItem(submenu).click();
    menuItem(label).click();
    await vi.advanceTimersByTimeAsync(1);
  }

  it('shows the protected notice, not a success toast, for a shuffle, a case change and a split the range refused', async () => {
    const { wb, toast, before } = await mount();
    await pick('Sort', 'Randomize range');
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/B2 is protected/), expect.objectContaining({ icon: 'lock' }));
    expect(toast).toHaveBeenCalledWith("Can't shuffle: the range has protected cells", expect.anything());
    expect(toast).not.toHaveBeenCalledWith(expect.stringMatching(/^Shuffled/), expect.anything());
    await pick('Data cleanup', 'UPPERCASE');
    expect(toast).not.toHaveBeenCalledWith(expect.stringMatching(/^Uppercased|No text to change/), expect.anything());
    await pick('Data cleanup', 'Split text to columns');
    expect(toast).not.toHaveBeenCalledWith(expect.stringMatching(/^Split|to split/), expect.anything());
    expect(JSON.stringify(wb.toJSON())).toBe(before);
  });
});
