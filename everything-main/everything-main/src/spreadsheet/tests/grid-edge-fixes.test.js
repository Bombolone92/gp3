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

describe('the link popover with frozen rows', () => {
  // A frozen cell's popover is hosted by the grid itself, over the pane and outside its clip; a plain cell's scrolls with the canvas.
  it('follows the active cell out of the pane and back', () => {
    const { wb, id, grid } = mount((wb, id) => {
      wb.setFrozen(id, 1, 0);
      wb.setLink(id, 0, 0, 'https://example.com/top', 'top');
      wb.setLink(id, 4, 0, 'https://example.com/five', 'five');
    });
    const pop = grid.el.querySelector('.link-pop');
    grid.setSelection(S.single(0, 0));
    vi.runOnlyPendingTimers();
    expect(pop.hidden).toBe(false);
    expect(pop.parentElement).toBe(grid.el);
    grid.setSelection(S.single(4, 0));
    vi.runOnlyPendingTimers();
    expect(pop.hidden).toBe(false);
    expect(pop.parentElement.classList.contains('grid-canvas')).toBe(true);
    grid.setSelection(S.single(0, 0));
    vi.runOnlyPendingTimers();
    expect(pop.parentElement).toBe(grid.el);
    grid.destroy();
  });
});

describe('a destroyed grid', () => {
  it('lets no pending long press or edit act after it is gone', () => {
    const { wb, id, grid } = mount();
    const viewport = grid.el.querySelector('.grid-viewport');
    const menus = [];
    viewport.addEventListener('contextmenu', () => menus.push(1));
    viewport.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'touch', clientX: 100, clientY: 60 }));
    grid.beginEdit({ text: 'typed', mode: 'type' });
    grid.destroy();
    grid.el.querySelector('.grid-editor').dispatchEvent(new FocusEvent('blur'));
    vi.advanceTimersByTime(1000);
    expect(menus).toEqual([]);
    expect(wb.getValue(id, 0, 0)).toBeNull();
  });
});

describe('inserting text while the formula bar is being typed in', () => {
  it('goes in at the formula bar caret and leaves the focus there', () => {
    const { grid } = mount();
    const bar = document.createElement('input');
    document.body.append(bar);
    grid.setFormulaInput(bar);
    grid.beginEdit({ text: 'abcdef', mode: 'edit' });
    bar.value = 'abcdef';
    bar.focus();
    bar.setSelectionRange(3, 3);
    grid.insertText('X');
    expect(bar.value).toBe('abcXdef');
    expect(grid.el.querySelector('.grid-editor').value).toBe('abcXdef');
    expect(document.activeElement).toBe(bar);
    expect(bar.selectionStart).toBe(4);
    grid.destroy();
  });
});

describe('Ctrl+O', () => {
  it('is left to the browser when no file picker exists', () => {
    const commands = [];
    const wb = new Workbook();
    const grid = createGrid({ wb, sheetId: wb.sheets[0].id, canOpen: false, onCommand: (c) => commands.push(c) });
    document.body.replaceChildren(grid.el);
    vi.runOnlyPendingTimers();
    const viewport = grid.el.querySelector('.grid-viewport');
    const e = new KeyboardEvent('keydown', { key: 'o', ctrlKey: true, bubbles: true, cancelable: true });
    viewport.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
    expect(commands).toEqual([]);
    grid.destroy();
    const withPicker = createGrid({ wb, sheetId: wb.sheets[0].id, onCommand: (c) => commands.push(c) });
    document.body.replaceChildren(withPicker.el);
    vi.runOnlyPendingTimers();
    const e2 = new KeyboardEvent('keydown', { key: 'o', ctrlKey: true, bubbles: true, cancelable: true });
    withPicker.el.querySelector('.grid-viewport').dispatchEvent(e2);
    expect(e2.defaultPrevented).toBe(true);
    expect(commands).toEqual(['open']);
    withPicker.destroy();
  });
});
describe('Enter after a run of Tabs', () => {
  it('returns to the column where tabbing began, one row down', () => {
    const { wb, id, grid } = mount();
    grid.setSelection(S.single(0, 1));
    grid.beginEdit({ text: 'x', mode: 'type' }); grid.commitEdit({ move: 'right' });
    grid.beginEdit({ text: 'y', mode: 'type' }); grid.commitEdit({ move: 'right' });
    grid.beginEdit({ text: 'z', mode: 'type' }); grid.commitEdit({ move: 'down' });
    expect([wb.getValue(id, 0, 1), wb.getValue(id, 0, 2), wb.getValue(id, 0, 3)]).toEqual(['x', 'y', 'z']);
    expect(grid.active).toEqual({ r: 1, c: 1 });
    // Without a Tab run, Enter simply moves down; a click elsewhere ends the run.
    grid.beginEdit({ text: 'w', mode: 'type' }); grid.commitEdit({ move: 'down' });
    expect(grid.active).toEqual({ r: 2, c: 1 });
    grid.beginEdit({ text: 'a', mode: 'type' }); grid.commitEdit({ move: 'right' });
    grid.setSelection(S.single(5, 5));
    grid.beginEdit({ text: 'b', mode: 'type' }); grid.commitEdit({ move: 'down' });
    expect(grid.active).toEqual({ r: 6, c: 5 });
    grid.destroy();
  });
});
describe('double-click autofit of a column', () => {
  it('ignores wrapped cells and rows a filter hides', () => {
    const { wb, id, grid } = mount((wb, id) => {
      wb.setInput(id, 0, 0, 'Head');
      wb.setInput(id, 1, 0, 'short');
      wb.setInput(id, 2, 0, 'x'.repeat(80));
      wb.applyStyle(id, { r1: 2, c1: 0, r2: 2, c2: 0 }, { wrap: true });
      wb.setInput(id, 3, 0, 'y'.repeat(60));
      wb.setFilterRange(id, { r1: 0, c1: 0, r2: 3, c2: 0 });
      wb.setFilterCriteria(id, 0, { values: ['short', 'x'.repeat(80)] });
    });
    expect(wb.sheet(id).filterHidden.has(3)).toBe(true);
    grid.el.querySelector('.col-resizer[data-c="0"]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const width = wb.colWidth(id, 0);
    expect(width).toBeLessThan(120); // "short" at 7px a character plus padding, not 60 or 80 characters
    expect(width).toBeGreaterThanOrEqual(40);
    grid.destroy();
  });
});

describe('hiding the row of the active cell', () => {
  it('moves the active cell to the next visible row instead of leaving it in a hidden one', () => {
    const { wb, id, grid } = mount((wb, id) => { for (let r = 0; r < 5; r++) wb.setInput(id, r, 0, `r${r}`); });
    grid.setSelection(S.single(1, 0));
    wb.setHidden(id, 'row', [1], true);
    vi.runOnlyPendingTimers();
    expect(grid.active).toEqual({ r: 2, c: 0 });
    const viewport = grid.el.querySelector('.grid-viewport');
    expect(document.getElementById(viewport.getAttribute('aria-activedescendant'))).toBeTruthy();
    grid.beginEdit({ text: 'q', mode: 'type' });
    expect(parseFloat(grid.el.querySelector('.grid-editor').style.height)).toBeGreaterThan(0);
    grid.cancelEdit?.();
    // A filter hiding the active row does the same.
    grid.setSelection(S.single(3, 0));
    wb.setFilterRange(id, { r1: 0, c1: 0, r2: 4, c2: 0 });
    wb.setFilterCriteria(id, 0, { values: ['r0', 'r4'] });
    vi.runOnlyPendingTimers();
    expect(wb.sheet(id).filterHidden.has(3)).toBe(true);
    expect(grid.active).toEqual({ r: 4, c: 0 });
    grid.destroy();
  });
});

describe('a merged block whose anchor is scrolled out of view', () => {
  it('renders its anchor once, with one row element per row', () => {
    const { grid } = mount((wb, id) => { wb.mergeCells(id, { r1: 0, c1: 0, r2: 0, c2: 10 }); wb.setInput(id, 0, 0, 'wide title'); wb.mergeCells(id, { r1: 0, c1: 12, r2: 0, c2: 14 }); });
    grid.setSelection(S.single(0, 0));
    const viewport = grid.el.querySelector('.grid-viewport');
    viewport.scrollLeft = 400;
    viewport.dispatchEvent(new Event('scroll'));
    vi.runOnlyPendingTimers();
    grid.refresh();
    vi.runOnlyPendingTimers();
    expect(document.querySelectorAll('#gc-0-0')).toHaveLength(1);
    expect(document.querySelectorAll('.grid-cells [role="row"][aria-rowindex="1"]')).toHaveLength(1);
    grid.destroy();
  });
});


describe('a label whose cell has scrolled off to the left', () => {
  // Only cells inside the view were built, so a long label spilling across empty neighbours
  // lost its visible tail as soon as its own column left the view.
  it('still draws its text spilling into the view', () => {
    const { grid } = mount((wb, id) => { wb.setInput(id, 0, 0, 'A long label that runs on '.repeat(20)); wb.setInput(id, 1, 0, '12345'); });
    const viewport = grid.el.querySelector('.grid-viewport');
    let scrollLeft = 0;
    Object.defineProperty(viewport, 'scrollLeft', { configurable: true, get: () => scrollLeft, set: (v) => { scrollLeft = v; } });
    viewport.scrollLeft = 450;
    viewport.dispatchEvent(new Event('scroll'));
    vi.runOnlyPendingTimers();
    grid.refresh();
    vi.runOnlyPendingTimers();
    expect(document.querySelector('#gc-0-1')).toBeNull(); // column B is out of view
    const label = document.querySelector('#gc-0-0');
    expect(label).toBeTruthy();
    expect(label.classList.contains('spill')).toBe(true);
    expect(document.querySelectorAll('#gc-0-0')).toHaveLength(1);
    expect(document.querySelector('#gc-1-0')).toBeNull(); // a number never spills, so it is not drawn
    grid.destroy();
  });
});

describe('a General number too wide for its column', () => {
  // The cell showed ### as soon as the full text did not fit. The General format drops
  // decimals first, then switches to scientific, and shows ### only when nothing fits.
  it('drops decimals, then goes scientific, and keeps ### for a chosen format', () => {
    const { grid } = mount((wb, id) => {
      wb.setInput(id, 0, 0, '3.14159265358979');
      wb.setInput(id, 1, 0, '123456789012345');
      wb.setInput(id, 2, 0, '3.14159265358979');
      wb.applyStyle(id, { r1: 2, c1: 0, r2: 2, c2: 0 }, { fmt: 'number', dec: 6 });
      wb.setInput(id, 3, 0, '0.000012345');
      wb.setInput(id, 4, 0, '123456789'); // an integer of ordinary size goes scientific too
      wb.setInput(id, 5, 0, '-123456');
      wb.setInput(id, 6, 0, '12345'); // five characters fit as they are
      wb.setColWidth(id, 0, 45); // 40px of text at 7px per character: five characters
    });
    grid.refresh();
    vi.runOnlyPendingTimers();
    const cell = (r) => document.querySelector(`#gc-${r}-0`);
    expect(cell(0).textContent).toBe('3.142');
    expect(cell(0).title).toBe('3.141592654'); // the full General text, for a hover
    expect(cell(1).textContent).toBe('1E+14');
    expect(cell(2).textContent).toBe('###');
    expect(cell(3).textContent).toBe('1E-05');
    expect(cell(4).textContent).toBe('1E+08');
    expect(cell(4).title).toBe('123456789');
    expect(cell(5).textContent).toBe('###'); // -1E+05 is six characters: nothing honest fits
    expect(cell(6).textContent).toBe('12345');
    grid.destroy();
  });
});
