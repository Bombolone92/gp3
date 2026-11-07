// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGrid } from '../src/ui/grid.js';
import { Workbook } from '../src/core/workbook.js';
import * as S from '../src/core/selection.js';

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return 800; } });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return 400; } });
  HTMLCanvasElement.prototype.getContext = () => ({ measureText: (t) => ({ width: t.length * 7 }), font: '' });
  Element.prototype.scrollTo = function scrollTo() {};
  Element.prototype.setPointerCapture = function setPointerCapture() {};
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
  vi.useFakeTimers();
});
afterEach(() => { vi.useRealTimers(); document.body.replaceChildren(); });

function mount(prepare) {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  prepare?.(wb, id);
  const grid = createGrid({ wb, sheetId: id });
  document.body.replaceChildren(grid.el);
  vi.runOnlyPendingTimers();
  return { wb, id, grid };
}

function type(grid, r, c, text) {
  grid.setSelection(S.single(r, c));
  grid.beginEdit({ text, mode: 'inplace' });
  grid.commitEdit();
  vi.runOnlyPendingTimers();
}

// Seven pixels per character in this harness: a 16-character date and time is 112px of text.
describe('a typed date or formatted number wider than a column nobody has sized', () => {
  it('widens the column so the value shows instead of ###', () => {
    const { wb, id, grid } = mount();
    type(grid, 0, 0, '2024-03-10 12:30');
    expect(wb.sheet(id).colWidths.get(0)).toBe(126);
    expect(document.querySelector('#gc-0-0').textContent).toBe('2024-03-10 12:30');
    type(grid, 0, 1, '=NOW()');
    expect(wb.sheet(id).colWidths.get(1)).toBe(126);
    grid.destroy();
  });

  it('leaves text, General numbers, and columns that were sized by hand alone', () => {
    const { wb, id, grid } = mount((wb, id) => wb.setColWidth(id, 3, 60));
    type(grid, 0, 0, 'a label that is long enough to overflow its column');
    type(grid, 0, 1, '3.14159265358979323');
    type(grid, 0, 2, '2024-03-10');
    type(grid, 0, 3, '2024-03-10 12:30');
    const widths = wb.sheet(id).colWidths;
    expect(widths.has(0)).toBe(false);
    expect(widths.has(1)).toBe(false);
    expect(widths.has(2)).toBe(false); // ten characters fit the default column
    expect(widths.get(3)).toBe(60);
    expect(document.querySelector('#gc-0-3').textContent).toBe('###');
    grid.destroy();
  });

  it('undoes the width together with the entry', () => {
    const { wb, id, grid } = mount();
    type(grid, 0, 0, '2024-03-10 12:30');
    expect(wb.sheet(id).colWidths.get(0)).toBe(126);
    wb.undo();
    expect(wb.getCell(id, 0, 0)).toBeUndefined();
    expect(wb.sheet(id).colWidths.has(0)).toBe(false);
    wb.redo();
    expect(wb.getCell(id, 0, 0)?.s?.fmt).toBe('datetime');
    expect(wb.sheet(id).colWidths.get(0)).toBe(126);
    grid.destroy();
  });
});
