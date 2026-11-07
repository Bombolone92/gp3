// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { openSortDialog } from '../src/ui/sortdialog.js';
import { closeAllModals } from '../src/ui/modal.js';
import { toast } from '../src/ui/toast.js';
import { Workbook } from '../src/core/workbook.js';
import { MAX_ROW, MAX_COL } from '../src/core/refs.js';

vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  toast.mockClear();
});
afterEach(() => {
  closeAllModals();
  vi.runAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

function open(range, active) {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, [[3, 1, 2], ['c', 'a', 'b'], [30, 10, 20]].flatMap((row, r) => row.map((v, c) => ({ r, c, cell: { v } }))));
  const modal = openSortDialog({ wb, sheetId: () => id, active: () => active, grid: { focus() {} } }, range);
  const direction = modal.panel.querySelector('[aria-label="Sort direction"]');
  const orient = (value) => { direction.value = value; direction.dispatchEvent(new Event('change')); };
  const field = (label) => modal.panel.querySelector(`[aria-label="${label}"]`);
  const submit = () => modal.panel.querySelector('form').requestSubmit();
  const row = (r) => [0, 1, 2].map((c) => wb.getValue(id, r, c));
  return { wb, id, modal, orient, field, submit, row };
}

// A whole-column selection reaches the dialog as a million rows; switching to
// "Sort columns" listed every one of them as an option.
it.each([MAX_ROW, 19999])('takes a typed row instead of listing %i rows when sorting columns', (lastRow) => {
  const { modal, orient, field } = open({ r1: 0, c1: 0, r2: lastRow, c2: 2 }, { r: 1, c: 0 });
  orient('cols');
  expect(modal.panel.querySelectorAll('option').length).toBeLessThan(20);
  const line = field('Sort by row');
  expect(line.tagName).toBe('INPUT');
  expect(line.value).toBe('2');
});

it('sorts the columns by the typed row', () => {
  const { orient, field, submit, row } = open({ r1: 0, c1: 0, r2: 19999, c2: 2 }, { r: 1, c: 0 });
  orient('cols');
  const line = field('Sort by row');
  line.value = '3';
  submit();
  expect(row(2)).toEqual([10, 20, 30]);
  expect(row(1)).toEqual(['a', 'b', 'c']);
  expect(toast).toHaveBeenCalledWith(expect.stringMatching(/^Sorted /));
});

it('refuses a typed row outside the range and keeps the dialog open', () => {
  const { wb, modal, orient, field, submit, row } = open({ r1: 1, c1: 0, r2: 19999, c2: 2 }, { r: 0, c: 0 });
  orient('cols');
  const before = wb.toJSON();
  const line = field('Sort by row');
  expect(line.value).toBe('2');
  for (const text of ['1', '0', 'abc', '']) {
    line.value = text;
    submit();
    expect(toast).toHaveBeenLastCalledWith('Enter a row from 2 to 20000 to sort by', { icon: 'info' });
    expect(wb.toJSON()).toEqual(before);
    expect(modal.panel.closest('.modal-root').classList.contains('closing')).toBe(false);
  }
  // The text row reads as a header column; sort all three columns by it.
  [...modal.panel.querySelectorAll('label')].find((label) => label.textContent.includes('header column')).querySelector('input').checked = false;
  line.value = ' 2 ';
  submit();
  expect(row(1)).toEqual(['a', 'b', 'c']);
  expect(row(2)).toEqual([10, 20, 30]);
  expect(row(0)).toEqual([3, 1, 2]); // above the range: untouched
  expect(wb.canUndo()).toBe(true);
});

it('takes a typed column letter when sorting the rows of a whole-row selection', () => {
  const { modal, field, submit, row } = open({ r1: 0, c1: 0, r2: 2, c2: MAX_COL }, { r: 0, c: 1 });
  expect(modal.panel.querySelectorAll('option').length).toBeLessThan(20);
  const line = field('Sort by column');
  expect(line.tagName).toBe('INPUT');
  expect(line.value).toBe('B');
  line.value = 'ZZZZ';
  submit();
  expect(toast).toHaveBeenLastCalledWith('Enter a column from A to XFD to sort by', { icon: 'info' });
  line.value = 'a';
  submit();
  expect([0, 1, 2].map((r) => row(r)[0])).toEqual([3, 30, 'c']);
});

it('still lists the lines of an ordinary range', () => {
  const { orient, field } = open({ r1: 0, c1: 0, r2: 2, c2: 2 }, { r: 0, c: 0 });
  expect(field('Sort by column').tagName).toBe('SELECT');
  expect(field('Sort by column').options).toHaveLength(3);
  orient('cols');
  expect(field('Sort by row').tagName).toBe('SELECT');
  expect([...field('Sort by row').options].map((o) => o.textContent)).toEqual(['Row 1', 'Row 2', 'Row 3']);
});
