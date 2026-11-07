// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createGrid } from '../src/ui/grid.js';
import { Workbook } from '../src/core/workbook.js';
import * as S from '../src/core/selection.js';

const grids = [];
const LONG = 'x'.repeat(40);
const flush = () => new Promise(resolve => setTimeout(resolve, 5));

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 400 });
  HTMLCanvasElement.prototype.getContext = () => ({ measureText: text => ({ width: text.length * 7 }), font: '' });
  Element.prototype.scrollTo = function () {};
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
  globalThis.requestAnimationFrame = fn => setTimeout(fn, 0);
  globalThis.cancelAnimationFrame = clearTimeout;
});

afterEach(() => {
  for (const grid of grids.splice(0)) grid.destroy();
  document.body.replaceChildren();
});

async function mount({ align = 'left', frozen = false } = {}) {
  const wb = new Workbook(), id = wb.activeSheetId;
  const c = align === 'left' ? 0 : 2;
  wb.setInput(id, 0, c, LONG);
  wb.applyStyle(id, { r1: 0, c1: c, r2: 0, c2: c }, { align, bg: '#ffcc00', bb: '#123456' });
  if (frozen) wb.setFrozen(id, 1, 3);
  const grid = createGrid({ wb, sheetId: id });
  grids.push(grid);
  document.body.append(grid.el);
  grid.viewport.getBoundingClientRect = () => ({ left: 0, top: 0, right: 800, bottom: 400, width: 800, height: 400 });
  await flush();
  const cells = () => [...grid.el.querySelectorAll(`.cell[data-r="0"][data-c="${c}"]`)];
  const editor = grid.el.querySelector('.grid-editor');
  return { wb, id, c, grid, cells, editor };
}

it.each([
  { align: 'left' }, { align: 'right' }, { align: 'center' }, { align: 'left', frozen: true },
])('removes saved overflow while the double-clicked editor shrinks ($align, frozen=$frozen)', async options => {
  const { wb, id, c, grid, cells, editor } = await mount(options);
  expect(cells().every(cell => cell.textContent === LONG && cell.classList.contains('spill'))).toBe(true);
  grid.viewport.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: c * 100 + 30, clientY: 10 }));
  editor.select();
  editor.setRangeText('a', 0, editor.value.length, 'end');
  editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'a' }));
  await flush();
  expect(grid.editing).toBe(true);
  expect(editor.value).toBe('a');
  expect(editor.style.width).toBe('100px');
  expect(wb.getCell(id, 0, c).v).toBe(LONG);
  for (const cell of cells()) {
    expect(cell.textContent).toBe('');
    expect(cell.classList.contains('spill')).toBe(false);
    expect(cell.style.width).toBe('100px');
    expect(cell.style.backgroundColor).toBe('rgb(255, 204, 0)');
    expect(cell.classList.contains('bb')).toBe(true);
  }
  // A viewport rebuild must keep every frozen copy's saved text hidden too.
  grid.redraw();
  await flush();
  expect(cells().every(cell => cell.textContent === '')).toBe(true);
  grid.cancelEdit();
  await flush();
  expect(cells().every(cell => cell.textContent === LONG && cell.classList.contains('spill'))).toBe(true);
});

it.each([false, true])('restores the saved display after a commit (changed=%s)', async changed => {
  const { wb, id, c, grid, cells } = await mount();
  grid.beginEdit();
  await flush();
  expect(cells()[0].textContent).toBe('');
  if (changed) grid.setEditText('a');
  expect(grid.commitEdit()).toBe(true);
  await flush();
  expect(cells()[0].textContent).toBe(changed ? 'a' : LONG);
  expect(cells()[0].classList.contains('spill')).toBe(!changed);
  if (changed) {
    wb.undo();
    await flush();
    expect(wb.getCell(id, 0, c).v).toBe(LONG);
    expect(cells()[0].textContent).toBe(LONG);
  }
});

it('hides only the edited cell on its own sheet while picking a formula reference', async () => {
  const { wb, id, grid, cells } = await mount();
  const other = wb.addSheet('Other').id;
  wb.setInput(other, 0, 0, 'Other label');
  grid.setSheet(id);
  grid.setSelection(S.single(0, 0));
  grid.beginEdit({ text: '=' });
  await flush();
  expect(cells()[0].textContent).toBe('');
  grid.setSheet(other);
  await flush();
  expect(grid.editing).toBe(true);
  expect(cells()[0].textContent).toBe('Other label');
  grid.setSheet(id);
  await flush();
  expect(cells()[0].textContent).toBe('');
  grid.cancelEdit();
  await flush();
  expect(cells()[0].textContent).toBe(LONG);
});
