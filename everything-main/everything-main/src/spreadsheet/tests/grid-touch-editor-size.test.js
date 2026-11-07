// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGrid } from '../src/ui/grid.js';
import { Workbook } from '../src/core/workbook.js';

let coarse = false;
beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return 800; } });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return 400; } });
  HTMLCanvasElement.prototype.getContext = () => ({ measureText: (t) => ({ width: t.length * 7 }), font: '' });
  Element.prototype.scrollTo = function scrollTo() {};
  globalThis.matchMedia = (q) => ({ matches: q.includes('coarse') ? coarse : false, addEventListener() {} });
  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
  vi.useFakeTimers();
});
afterEach(() => { vi.useRealTimers(); document.body.replaceChildren(); coarse = false; });

function open(size) {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  wb.setInput(id, 0, 0, 'text');
  if (size) wb.applyStyle(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, { size });
  const grid = createGrid({ wb, sheetId: id });
  document.body.replaceChildren(grid.el);
  vi.runOnlyPendingTimers();
  grid.beginEdit({ text: 'text', mode: 'edit' });
  return grid.el.querySelector('.grid-editor').style.fontSize;
}

describe('the in-cell editor on a touch screen', () => {
  it('is never smaller than 16px, whatever the cell size, so iOS does not zoom into it', () => {
    coarse = true;
    expect(parseFloat(open())).toBe(16);
    expect(parseFloat(open(10))).toBe(16);
    expect(parseFloat(open(20))).toBe(20);
  });

  it('matches the cell size with a mouse', () => {
    expect(parseFloat(open())).toBe(13);
    expect(parseFloat(open(10))).toBe(10);
  });
});
