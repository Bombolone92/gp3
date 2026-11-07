// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';
import { openSortDialog } from '../src/ui/sortdialog.js';
import { closeAllModals } from '../src/ui/modal.js';
import { toast } from '../src/ui/toast.js';

vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  document.body.innerHTML = '<div id="app"></div>';
  toast.mockClear();
});
afterEach(() => {
  closeAllModals();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

function fixture(data, range = 'A1:F6') {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  data.forEach((row, r) => row.forEach((v, c) => wb.setInput(id, r, c, String(v))));
  wb.clearHistory();
  const grid = { focus: vi.fn() };
  const { panel, close } = openSortDialog({ wb, sheetId: () => id, active: () => ({ r: 0, c: 0 }), grid }, parseRange(range));
  const rows = () => [...panel.querySelectorAll('.sort-level')];
  const field = (label, row = 0) => rows()[row].querySelector(`[aria-label="${label}"]`);
  const button = (name) => [...panel.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || b.textContent.trim()) === name);
  const change = (label, value, row = 0) => { const node = field(label, row); node.value = value; node.dispatchEvent(new Event('change', { bubbles: true })); };
  return { wb, id, panel, close, rows, field, button, change, grid, submit: () => panel.querySelector('form').requestSubmit() };
}
const data = [
  ['Group', 'Rank', 'Batch', 'Score', 'Label', 'Echo'],
  ['A', 1, 1, 3, 'third', '=D2*10'],
  ['A', 1, 1, 1, 'first', '=D3*10'],
  ['A', 1, 1, 2, 'second', '=D4*10'],
  ['A', 1, 2, 0, 'next', '=D5*10'],
  ['B', 0, 0, 0, 'last', '=D6*10'],
];

it('uses a fourth key to break ties while moving formulas, notes and formatting, with exact Undo', () => {
  const f = fixture(data);
  f.wb.setNote(f.id, 1, 4, 'Belongs to third');
  f.wb.applyStyle(f.id, parseRange('E2'), { bold: true, bg: '#ff0000' });
  f.wb.clearHistory();
  const before = f.wb.toJSON();
  for (let i = 0; i < 3; i++) f.button('Add another level').click();
  expect(f.rows()).toHaveLength(4);
  expect(f.rows().map((row) => row.querySelector('.sort-priority').textContent)).toEqual(['Sort by', 'Then by', 'Then by', 'Then by']);
  f.submit();
  expect(f.wb.rangeValues(f.id, parseRange('E2:F6'))).toEqual([['first', 10], ['second', 20], ['third', 30], ['next', 0], ['last', 0]]);
  expect(f.wb.getCell(f.id, 3, 5).f).toBe('D4*10');
  expect(f.wb.getCell(f.id, 3, 4).s).toMatchObject({ bold: true, bg: '#ff0000' });
  expect(f.wb.getNote(f.id, 3, 4)).toBe('Belongs to third');
  expect(f.wb.undoLabel()).toBe('Sort');
  f.wb.undo();
  expect(f.wb.toJSON()).toEqual(before);
  expect(f.wb.undoLabel()).toBeNull();
});

it('reorders existing drafts and applies the new priority without changing the workbook beforehand', () => {
  const f = fixture([['Group', 'Score'], ['A', 1], ['B', 3], ['A', 2]], 'A1:B4');
  const before = f.wb.toJSON();
  f.button('Add another level').click();
  f.change('Order', 'desc', 1);
  const score = f.field('Sort by column', 1);
  f.button('Move level up').click();
  expect(f.field('Sort by column')).toBe(score);
  expect(f.field('Order').value).toBe('desc');
  expect(document.activeElement).toBe(score);
  expect(f.button('Move level up').disabled).toBe(true);
  expect(f.panel.querySelector('[role="status"]').textContent).toBe('Level 1 of 2');
  expect(f.wb.toJSON()).toEqual(before);
  f.button('Move level down').click();
  expect(f.field('Sort by column', 1)).toBe(score);
  f.button('Move level up').click();
  f.submit();
  expect(f.wb.rangeValues(f.id, parseRange('A2:B4'))).toEqual([['B', 3], ['A', 2], ['A', 1]]);
  f.wb.undo();
  expect(f.wb.toJSON()).toEqual(before);
});

it('copies a fill-color level after the selected row, then prioritizes two fills in the same column', () => {
  const f = fixture([['Score'], [3], [2], [4], [1], [5]], 'A1:A6');
  f.wb.applyStyle(f.id, parseRange('A3'), { bg: '#0000ff' });
  f.wb.applyStyle(f.id, parseRange('A5'), { bg: '#0000ff' });
  f.wb.applyStyle(f.id, parseRange('A4'), { bg: '#ff0000' });
  f.wb.applyStyle(f.id, parseRange('A6'), { bg: '#ff0000' });
  f.wb.clearHistory();
  const before = f.wb.toJSON();
  f.change('Sort on', 'color');
  f.change('Fill color', '#ff0000');
  f.button('Copy level').click();
  expect(f.rows()).toHaveLength(2);
  expect(f.field('Sort on', 1).value).toBe('color');
  expect(f.field('Fill color', 1).value).toBe('#ff0000');
  expect(f.field('Order', 1).value).toBe('colorTop');
  expect(document.activeElement).toBe(f.field('Sort by column', 1));
  f.change('Fill color', '#0000ff', 1);
  f.button('Add another level').click();
  expect(f.field('Sort on', 2).value).toBe('value');
  f.submit();
  expect(f.wb.rangeValues(f.id, parseRange('A2:A6'))).toEqual([[4], [5], [1], [2], [3]]);
  f.wb.undo();
  expect(f.wb.toJSON()).toEqual(before);
});

it('caps Add and Copy at 64 levels, and restores them after removing the selected row', () => {
  const f = fixture([[3], [1], [2]], 'A1:A3');
  const before = f.wb.toJSON();
  for (let i = 1; i < 64; i++) f.button('Copy level').click();
  expect(f.rows()).toHaveLength(64);
  expect(f.button('Add another level').disabled).toBe(true);
  expect(f.button('Copy level').disabled).toBe(true);
  f.rows()[63].querySelector('[aria-label="Remove this level"]').click();
  expect(f.rows()).toHaveLength(63);
  expect(f.panel.querySelector('[role="status"]').textContent).toBe('Level 63 of 63');
  expect(f.button('Add another level').disabled).toBe(false);
  expect(f.button('Copy level').disabled).toBe(false);
  expect(f.button('Move level down').disabled).toBe(true);
  expect(f.wb.toJSON()).toEqual(before);
  f.close();
  expect(f.wb.undoLabel()).toBeNull();
});

it('selects a level from any focused field and copies that draft rather than the last level', () => {
  const f = fixture(data);
  f.button('Add another level').click();
  f.button('Add another level').click();
  f.change('Order', 'desc', 0);
  f.field('Order', 0).focus();
  f.button('Copy level').click();
  expect(f.rows().map((row) => row.querySelector('[aria-label="Sort by column"]').value)).toEqual(['0', '0', '1', '2']);
  expect(f.field('Order', 1).value).toBe('desc');
  expect(f.panel.querySelector('[role="status"]').textContent).toBe('Level 2 of 4');
});

it('resets levels on orientation change, marks unsupported modes disabled, and sorts columns with four keys', () => {
  const f = fixture([['Label', 'third', 'first', 'second'], ['Group', 1, 1, 1], ['Batch', 1, 1, 1], ['Score', 3, 1, 2]], 'A1:D4');
  f.button('Copy level').click();
  const direction = f.panel.querySelector('[aria-label="Sort direction"]');
  direction.value = 'cols';
  direction.dispatchEvent(new Event('change'));
  expect(f.rows()).toHaveLength(1);
  expect(f.field('Sort on').querySelector('option[value="color"]').disabled).toBe(true);
  expect(f.field('Sort on').querySelector('option[value="font"]').disabled).toBe(true);
  expect(f.field('Sort on').querySelector('option[value="icon"]').disabled).toBe(true);
  // Keep the header column, and use three tied numeric rows before the label.
  f.panel.querySelector('input[type="checkbox"]').checked = true;
  for (let i = 0; i < 3; i++) f.button('Add another level').click();
  [1, 2, 3, 0].forEach((value, i) => f.change('Sort by row', String(value), i));
  f.submit();
  expect(f.wb.rangeValues(f.id, parseRange('A1:D1'))).toEqual([['Label', 'first', 'second', 'third']]);
});

it('preserves an invalid typed row in a copy and refuses submission without changing cells', () => {
  const f = fixture([[3, 1, 2]], 'A1:C1000');
  const direction = f.panel.querySelector('[aria-label="Sort direction"]');
  direction.value = 'cols';
  direction.dispatchEvent(new Event('change'));
  f.change('Sort by row', 'not a row');
  f.button('Copy level').click();
  expect(f.field('Sort by row', 1).value).toBe('not a row');
  f.submit();
  expect(toast).toHaveBeenCalledWith('Enter a row from 1 to 1000 to sort by', expect.anything());
  expect(f.wb.undoLabel()).toBeNull();
  expect(f.wb.rangeValues(f.id, parseRange('A1:C1'))).toEqual([[3, 1, 2]]);
});

it('recovers selection and action states when the last level is removed and another added', () => {
  const f = fixture([[3], [1], [2]], 'A1:A3');
  f.button('Remove this level').click();
  expect(f.rows()).toHaveLength(0);
  expect(f.button('Copy level').disabled).toBe(true);
  expect(f.button('Move level up').disabled).toBe(true);
  expect(f.button('Move level down').disabled).toBe(true);
  expect(document.activeElement).toBe(f.button('Add another level'));
  f.button('Add another level').click();
  expect(document.activeElement).toBe(f.field('Sort by column'));
  expect(f.button('Copy level').disabled).toBe(false);
  expect(f.panel.querySelector('[role="status"]').textContent).toBe('Level 1 of 1');
  f.button('Cancel').click();
  expect(f.wb.undoLabel()).toBeNull();
  expect(f.grid.focus).toHaveBeenCalled();
});
