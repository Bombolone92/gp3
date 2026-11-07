// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createGrid } from '../src/ui/grid.js';
import { createFormulaBar } from '../src/ui/formulabar.js';
import { Workbook } from '../src/core/workbook.js';
import * as notifications from '../src/ui/toast.js';

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return 800; } });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return 400; } });
  HTMLCanvasElement.prototype.getContext = () => ({ measureText: (t) => ({ width: t.length * 7 }), font: '' });
  Element.prototype.scrollTo = function scrollTo() {};
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
});

const flush = () => new Promise((r) => setTimeout(r, 5));
const key = (target, key, init = {}) => target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));

function setup(gridOptions = {}) {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  wb.setInput(id, 0, 0, 'Name');
  const listeners = new Set();
  const grid = createGrid({ ...gridOptions, wb, sheetId: id, announce() {}, onCommand() {}, onSelection: () => { for (const fn of listeners) fn(); }, onEdit: () => { for (const fn of listeners) fn(); } });
  const ctx = {
    wb, grid, run() {}, announce() {}, goToName: () => false,
    sheetId: () => grid.sheetId, range: () => grid.range, ranges: () => grid.ranges,
    activeCell: () => wb.getCell(grid.sheetId, grid.active.r, grid.active.c),
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
  const bar = createFormulaBar(ctx);
  document.body.replaceChildren(grid.el, bar.el);
  return { wb, id, grid, bar, input: bar.el.querySelector('.formula-input') };
}

describe('formula bar', () => {
  it('applies an entry without moving the selection, with one undo step', () => {
    const { wb, id, grid, bar, input } = setup();
    const actions = bar.el.querySelector('.fx-actions');
    expect(actions.hidden).toBe(true);
    grid.selectByName('A1:B2');
    input.focus();
    input.value = '=2+3';
    input.dispatchEvent(new Event('input'));
    expect(actions.hidden).toBe(false);
    bar.el.querySelector('[aria-label="Apply edit"]').click();
    expect(wb.getValue(id, 0, 0)).toBe(5);
    expect(grid.range).toEqual({ r1: 0, c1: 0, r2: 1, c2: 1 });
    expect(grid.editing).toBe(false);
    expect(actions.hidden).toBe(true);
    expect(document.activeElement).toBe(grid.viewport);
    wb.undo();
    expect(wb.getValue(id, 0, 0)).toBe('Name');
    bar.destroy(); grid.destroy();
  });

  it('cancels an in-cell edit from the bar and restores the original value', () => {
    const { wb, id, grid, bar, input } = setup();
    grid.beginEdit({ text: 'Discard me' });
    expect(input.value).toBe('Discard me');
    bar.el.querySelector('[aria-label="Cancel edit"]').click();
    expect(wb.getValue(id, 0, 0)).toBe('Name');
    expect(input.value).toBe('Name');
    expect(grid.editing).toBe(false);
    expect(bar.el.querySelector('.fx-actions').hidden).toBe(true);
    expect(document.activeElement).toBe(grid.viewport);
    bar.destroy(); grid.destroy();
  });

  it('keeps a rejected entry editable when Apply is clicked', () => {
    const { wb, id, grid, bar, input } = setup({ validate: () => ({ ok: false, strict: true }) });
    input.focus();
    input.value = 'Invalid';
    input.dispatchEvent(new Event('input'));
    bar.el.querySelector('[aria-label="Apply edit"]').click();
    expect(wb.getValue(id, 0, 0)).toBe('Name');
    expect(grid.editState.text).toBe('Invalid');
    expect(bar.el.querySelector('.fx-actions').hidden).toBe(false);
    expect(document.activeElement).toBe(grid.el.querySelector('.grid-editor'));
    bar.destroy(); grid.destroy();
  });

  it('preserves character formatting when editing an existing label', async () => {
    const { wb, id, grid, bar, input } = setup();
    wb.setCells(id, [{ r: 0, c: 0, cell: { v: 'DC - Debit card', richText: [
      { text: 'DC', s: { bold: true } }, { text: ' - Debit card', s: { bold: false } },
    ] } }]);
    await flush();
    input.focus();
    input.value = 'DC - Debit cards';
    input.dispatchEvent(new Event('input'));
    key(input, 'Enter');
    expect(wb.getCell(id, 0, 0).richText).toEqual([
      { text: 'DC', s: { bold: true } }, { text: ' - Debit cards', s: { bold: false } },
    ]);
    wb.undo();
    expect(wb.getCell(id, 0, 0).richText[1].text).toBe(' - Debit card');
    bar.destroy(); grid.destroy();
  });
  it('shows why a name typed into the name box was refused, and keeps it there to correct', async () => {
    const { wb, bar } = setup();
    await flush();
    const toast = vi.spyOn(notifications, 'toast').mockImplementation(() => {});
    const nameBox = bar.el.querySelector('.name-box');
    nameBox.value = '1st';
    key(nameBox, 'Enter');
    const reason = wb.validateName('1st');
    expect(reason).toBeTruthy();
    expect(toast).toHaveBeenCalledWith(reason, expect.objectContaining({ icon: 'alert' }));
    expect(nameBox.value).toBe('1st');
    expect(wb.names).toHaveLength(0);
    toast.mockRestore();
  });

  it('edits the active cell and commits on Enter', async () => {
    const { wb, id, grid, input } = setup();
    await flush();
    expect(input.value).toBe('Name');
    input.focus();
    expect(grid.editing).toBe(true);
    input.value = 'Title';
    input.dispatchEvent(new Event('input'));
    expect(grid.editState.text).toBe('Title');
    key(input, 'Enter');
    expect(grid.editing).toBe(false);
    expect(wb.getCell(id, 0, 0).v).toBe('Title');
    expect(grid.active).toEqual({ r: 1, c: 0 });
  });

  it('hands focus back to the grid on a protected cell instead of taking text that cannot land', async () => {
    const { wb, id, grid, input } = setup();
    wb.protectRange(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, 'Header');
    await flush();
    input.focus();
    expect(grid.editing).toBe(false);
    expect(document.activeElement).toBe(grid.viewport);
    expect(input.value).toBe('Name');
    // Typing that still reaches the bar changes nothing.
    input.value = 'Namex';
    input.dispatchEvent(new Event('input'));
    expect(grid.editing).toBe(false);
    expect(input.value).toBe('Name');
    expect(wb.getCell(id, 0, 0).v).toBe('Name');
  });
});


it('keeps composition Enter and Escape inside the formula bar', () => {
  const { grid, input } = setup();
  input.focus();
  for (const name of ['Enter', 'Escape']) {
    const event = new KeyboardEvent('keydown', { key: name, isComposing: true, bubbles: true, cancelable: true });
    input.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(grid.editing).toBe(true);
  }
  grid.destroy();
});


it('fills the selection with Ctrl+Enter from the formula bar', () => {
  const { wb, id, grid, input } = setup();
  grid.selectByName('A1:A3');
  input.focus();
  input.value = 'Shared';
  input.dispatchEvent(new Event('input'));
  key(input, 'Enter', { ctrlKey: true });
  expect([0, 1, 2].map((r) => wb.getValue(id, r, 0))).toEqual(['Shared', 'Shared', 'Shared']);
  expect(grid.active).toEqual({ r: 0, c: 0 });
  wb.undo();
  expect(wb.getValue(id, 0, 0)).toBe('Name');
  grid.destroy();
});

it.each(['Enter', 'Tab'])('keeps the rejected edit focused after %s in the formula bar', (name) => {
  const { grid, input, wb, id } = setup({ validate: () => ({ ok: false, strict: true }) });
  input.focus();
  input.value = 'Invalid';
  input.dispatchEvent(new Event('input'));
  key(input, name);
  expect(grid.editing).toBe(true);
  expect(document.activeElement).toBe(grid.el.querySelector('.grid-editor'));
  expect(grid.active).toEqual({ r: 0, c: 0 });
  expect(wb.getValue(id, 0, 0)).toBe('Name');
  grid.destroy();
});

it('accepts suggestions at the formula bar caret and keeps focus there', () => {
  const { grid, input } = setup();
  input.focus();
  input.value = '=SU+1';
  input.setSelectionRange(3, 3);
  input.dispatchEvent(new Event('input'));
  key(input, 'Tab');
  expect(grid.editing).toBe(true);
  expect(input.value).toBe('=SUM(+1');
  expect(grid.editState.text).toBe('=SUM(+1');
  expect(document.activeElement).toBe(input);
  expect(input.selectionStart).toBe(5);
  grid.destroy();
});

it('cycles reference anchors at the formula bar caret with F4', () => {
  const { grid, input } = setup();
  input.focus();
  input.value = '=A1+B2';
  input.setSelectionRange(3, 3);
  input.dispatchEvent(new Event('input'));
  key(input, 'F4');
  expect(input.value).toBe('=$A$1+B2');
  expect(grid.editState.text).toBe(input.value);
  expect(document.activeElement).toBe(input);
  grid.destroy();
});

it('inserts a picked reference at the formula bar caret', () => {
  const { grid, input } = setup();
  input.focus();
  input.value = '=1++2';
  input.setSelectionRange(3, 3);
  input.dispatchEvent(new Event('input'));
  expect(grid.acceptsRef()).toBe(true);
  grid.insertRef({ r1: 1, c1: 1, r2: 1, c2: 1 });
  expect(input.value).toBe('=1+B2+2');
  expect(grid.editState.text).toBe(input.value);
  expect(input.selectionStart).toBe(5);
  expect(document.activeElement).toBe(input);
  grid.destroy();
});

it('keeps multiline caret navigation in the formula bar and commits Alt+Enter text', () => {
  const { wb, id, grid, input, bar } = setup();
  grid.beginEdit({ text: 'First', mode: 'type' });
  input.focus();
  input.setSelectionRange(5, 5);
  key(input, 'Enter', { altKey: true });
  expect(input.value).toBe('First\n');
  expect(bar.expanded).toBe(true);
  const up = new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true });
  input.dispatchEvent(up);
  expect(up.defaultPrevented).toBe(false);
  expect(grid.editing).toBe(true);
  key(input, 'Enter');
  expect(wb.getValue(id, 0, 0)).toBe('First\n');
  expect(wb.getCell(id, 0, 0).s.wrap).toBe(true);
  grid.destroy();
});

it('restores the selected address when Escape cancels the name box', () => {
  const { grid, bar } = setup();
  grid.selectByName('B3');
  const name = bar.el.querySelector('.name-box');
  name.focus();
  name.value = 'Unfinished name';
  const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  name.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  expect(name.value).toBe('B3');
  expect(document.activeElement).toBe(grid.viewport);
  grid.destroy();
});

it('commits a pending edit before navigating from the name box', () => {
  const { wb, id, grid, bar } = setup();
  grid.beginEdit({ text: 'Changed' });
  const name = bar.el.querySelector('.name-box');
  name.focus();
  name.value = 'B2';
  key(name, 'Enter');
  expect(grid.editing).toBe(false);
  expect(wb.getValue(id, 0, 0)).toBe('Changed');
  expect(grid.active).toEqual({ r: 1, c: 1 });
  grid.destroy();
});

it('returns to the pending edit when Escape cancels name-box navigation', () => {
  const { grid, bar } = setup();
  grid.beginEdit({ text: 'Pending' });
  const name = bar.el.querySelector('.name-box');
  name.focus();
  name.value = 'B2';
  key(name, 'Escape');
  expect(grid.editState.text).toBe('Pending');
  expect(document.activeElement).toBe(grid.el.querySelector('.grid-editor'));
  grid.destroy();
});
