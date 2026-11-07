// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createGrid } from '../src/ui/grid.js';
import { Workbook, DEFAULT_ROW_HEIGHT } from '../src/core/workbook.js';

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return 800; } });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return 400; } });
  HTMLCanvasElement.prototype.getContext = () => ({ measureText: (t) => ({ width: t.length * 7 }), font: '' });
  Element.prototype.scrollTo = function scrollTo() {};
  Element.prototype.setPointerCapture = function () {};
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
});
afterEach(() => { document.body.replaceChildren(); });

const ROW = Math.round(DEFAULT_ROW_HEIGHT); // a default row on screen at 100%
const flush = () => new Promise((r) => setTimeout(r, 5));
const key = (target, k, init = {}) => target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));

function setup(cells = {}) {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  for (const [k, text] of Object.entries(cells)) { const [r, c] = k.split(',').map(Number); wb.setInput(id, r, c, text); }
  const commands = [];
  const grid = createGrid({ wb, sheetId: id, announce() {}, onCommand: (cmd, arg) => commands.push([cmd, arg]) });
  document.body.replaceChildren(grid.el);
  return { wb, id, grid, commands, viewport: grid.el.querySelector('.grid-viewport') };
}
it('marks every cell of the selection as selected for assistive technology', async () => {
  const { grid } = setup();
  await flush();
  grid.selectByName('A1:B2');
  await flush();
  const marked = () => [...grid.el.querySelectorAll('.cell[aria-selected="true"]')].map((n) => n.id).sort();
  expect(marked()).toEqual(['gc-0-0', 'gc-0-1', 'gc-1-0', 'gc-1-1']);
  grid.selectByName('D4');
  await flush();
  expect(marked()).toEqual(['gc-3-3']);
  grid.destroy();
});

// A range made of hidden lines alone keeps its active cell, so Unhide still knows which lines are
// meant — but the render loop skips hidden rows and columns, so aria-activedescendant named a node
// that was not in the DOM and a screen reader following the grid's cursor lost it, silently.
it.each([
  ['row', { active: { r: 3, c: 0 }, anchor: { r: 3, c: 0 }, focus: { r: 5, c: 0 } }, [3, 4, 5], 'gc-3-0'],
  ['col', { active: { r: 0, c: 2 }, anchor: { r: 0, c: 2 }, focus: { r: 0, c: 4 } }, [2, 3, 4], 'gc-0-2'],
])('keeps the active cell in the DOM when its %s is hidden under it', async (axis, selection, lines, id) => {
  const { wb, id: sheetId, grid } = setup();
  await flush();
  grid.setSelection(selection);
  await flush();
  wb.setHidden(sheetId, axis, lines, true);
  await flush();
  expect(grid.viewport.getAttribute('aria-activedescendant')).toBe(id);
  const node = document.getElementById(id);
  expect(node).not.toBeNull();
  expect(node.getAttribute('aria-selected')).toBe('true');
  expect(node.classList.contains('sizeless')).toBe(true); // no extent, and so nothing drawn
  expect([...grid.el.querySelectorAll('.grid-cells .cell')].filter((n) => n.id === id)).toHaveLength(1);

  wb.setHidden(sheetId, axis, lines, false);
  await flush();
  expect(document.getElementById(id).classList.contains('sizeless')).toBe(false);
  grid.destroy();
});

// A merge whose anchor row is hidden still reaches into the shown rows below: it has a size, and
// must keep the borders and padding a cell with no extent gives up.
it('leaves a merge reaching out of a hidden row its size and its borders', async () => {
  const { wb, id, grid } = setup({ '3,0': 'merged' });
  wb.mergeCells(id, { r1: 3, c1: 0, r2: 5, c2: 1 });
  await flush();
  grid.selectByName('A4');
  wb.setHidden(id, 'row', [3], true);
  await flush();
  const node = document.getElementById('gc-3-0');
  expect(node.style.height).toBe(`${2 * ROW}px`); // rows 5 and 6, the shown part of A4:B6
  expect(node.classList.contains('sizeless')).toBe(false);
  grid.destroy();
});
