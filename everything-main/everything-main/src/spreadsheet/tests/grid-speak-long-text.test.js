// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createGrid } from '../src/ui/grid.js';
import { Workbook } from '../src/core/workbook.js';
import * as S from '../src/core/selection.js';

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return 800; } });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return 400; } });
  HTMLCanvasElement.prototype.getContext = () => ({ measureText: (t) => ({ width: t.length * 7 }), font: '' });
  Element.prototype.scrollTo = function scrollTo() {};
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
});
afterEach(() => { document.body.replaceChildren(); });

const flush = () => new Promise((r) => setTimeout(r, 5));

// Selecting a cell speaks its text; a cell holding 32,767 characters pushed all of them into the
// live region, which a screen reader then reads out in full or chokes on.
it('speaks the start of a very long cell text and says how long it is, and short text in full', async () => {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  wb.setInput(id, 0, 0, 'x'.repeat(32767));
  wb.setInput(id, 1, 0, 'A short label');
  const announced = [];
  const grid = createGrid({ wb, sheetId: id, announce: (t) => announced.push(t) });
  document.body.replaceChildren(grid.el);
  await flush();
  grid.setSelection(S.single(0, 0));
  const long = announced[announced.length - 1];
  expect(long.startsWith('A1, xxxxxxxx')).toBe(true);
  expect(long.length).toBeLessThan(300);
  expect(long).toMatch(/32,767 characters/);
  grid.setSelection(S.single(1, 0));
  expect(announced[announced.length - 1]).toBe('A2, A short label');
  grid.destroy();
});
