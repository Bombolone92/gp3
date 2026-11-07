// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { openTableDialog } from '../src/ui/tabledialog.js';
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

function setup() {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  const range = { r1: 0, c1: 0, r2: 4, c2: 1 };
  wb.setCells(id, [['Item', 'Amount'], ['A', 10], ['B', 20], ['C', 30], ['D', 40]].flatMap((row, r) => row.map((v, c) => ({ r, c, cell: { v } }))));
  const modal = openTableDialog({ wb, sheetId: () => id, grid: { focus() {}, setSelection() {} } }, { range });
  const rangeInput = modal.panel.querySelector('[aria-label="Range"]');
  const alert = modal.panel.querySelector('[role="alert"]');
  const submit = () => modal.panel.querySelector('form').requestSubmit();
  const check = (text) => [...modal.panel.querySelectorAll('label')].find((label) => label.textContent.includes(text)).querySelector('input');
  const open = () => !modal.panel.closest('.modal-root').classList.contains('closing');
  return { wb, id, modal, rangeInput, alert, submit, check, open };
}

// addTable refuses merged cells; with "My data has a header row" off, the
// dialog had already inserted the header row when it found out.
it.each([false, true])('refuses a range with merged cells without leaving a row behind (header row: %s)', (header) => {
  const { wb, id, alert, submit, check, open } = setup();
  wb.mergeCells(id, { r1: 1, c1: 0, r2: 1, c2: 1 });
  check('My data has a header').checked = header;
  wb.clearHistory();
  const before = wb.toJSON();
  submit();
  expect(wb.toJSON()).toEqual(before);
  expect(wb.canUndo()).toBe(false);
  expect(wb.getValue(id, 0, 0)).toBe('Item');
  expect(open()).toBe(true);
  expect(alert.hidden).toBe(false);
  expect(alert.textContent).toMatch(/merged/i);
  expect(toast).not.toHaveBeenCalled();
  // Unmerging clears the way; the same draft then creates the table.
  wb.unmergeCells(id, { r1: 1, c1: 0, r2: 1, c2: 1 });
  submit();
  expect(open()).toBe(false);
  expect(wb.tablesOn(id)).toHaveLength(1);
  expect(wb.tablesOn(id)[0].range).toEqual({ r1: 0, c1: 0, r2: header ? 4 : 5, c2: 1 });
});

it.each([
  ['a1:b3', { r1: 0, c1: 0, r2: 2, c2: 1 }],
  ['Sheet1!A1:B3', { r1: 0, c1: 0, r2: 2, c2: 1 }],
  ['B3:A1', { r1: 0, c1: 0, r2: 2, c2: 1 }],
  ['Sales', { r1: 0, c1: 0, r2: 3, c2: 1 }],
])('reads the table range %s the way every other range box does', (text, expected) => {
  const { wb, id, rangeInput, submit, open } = setup();
  wb.defineName('Sales', 'Sheet1!A1:B4');
  rangeInput.value = text;
  submit();
  expect(open()).toBe(false);
  expect(wb.tablesOn(id)).toHaveLength(1);
  expect(wb.tablesOn(id)[0].range).toEqual(expected);
});

it('refuses a range on another sheet and keeps the draft', () => {
  const { wb, id, rangeInput, alert, submit, open } = setup();
  const other = wb.addSheet('Other');
  wb.setCells(other.id, [['H1', 'H2'], [1, 2]].flatMap((row, r) => row.map((v, c) => ({ r, c, cell: { v } }))));
  wb.clearHistory();
  const before = wb.toJSON();
  rangeInput.value = 'Other!A1:B2';
  submit();
  expect(wb.toJSON()).toEqual(before);
  expect(wb.canUndo()).toBe(false);
  expect(open()).toBe(true);
  expect(alert.hidden).toBe(false);
  expect(alert.textContent).toMatch(/this sheet/i);
  expect(wb.tablesOn(id)).toHaveLength(0);
  expect(wb.tablesOn(other.id)).toHaveLength(0);
  expect(toast).not.toHaveBeenCalled();
});

it('re-detects the header row from a sheet-qualified range as it is typed', () => {
  const { rangeInput, check } = setup();
  const header = check('My data has a header');
  expect(header.checked).toBe(true);
  rangeInput.value = 'Sheet1!A2:B5';
  rangeInput.dispatchEvent(new Event('input', { bubbles: true }));
  expect(header.checked).toBe(false);
  rangeInput.value = 'Sheet1!A1:B5';
  rangeInput.dispatchEvent(new Event('input', { bubbles: true }));
  expect(header.checked).toBe(true);
});

it('creates and edits first/last column options with accessible labels', () => {
  const { wb, id, submit, check } = setup();
  check('First column').checked = true;
  check('Last column').checked = true;
  submit();
  const table = wb.tablesOn(id)[0];
  expect(table).toMatchObject({ firstColumn: true, lastColumn: true });
  const modal = openTableDialog({ wb, sheetId: () => id, grid: { focus() {}, setSelection() {} } }, { table });
  const option = name => [...modal.panel.querySelectorAll('label')].find(label => label.textContent === name).querySelector('input');
  expect(option('First column').checked).toBe(true);
  expect(option('Last column').checked).toBe(true);
  option('Last column').checked = false;
  modal.panel.querySelector('form').requestSubmit();
  expect(wb.tablesOn(id)[0].firstColumn).toBe(true);
  expect(wb.tablesOn(id)[0].lastColumn).toBeUndefined();
  wb.undo(); expect(wb.tablesOn(id)[0].lastColumn).toBe(true);
});


it.each([false, true])('refuses native report overlap before inserting a header (header row: %s)', header => {
  const { wb, id, alert, submit, check, open } = setup();
  const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  wb.nativePivots = { version: 1, caches: [{ key: 'cache', xml: `<pivotCacheDefinition xmlns="${ns}"/>` }],
    tables: [{ name: 'Native', owner: id, cache: 'cache', ref: 'A1:B5', xml: `<pivotTableDefinition xmlns="${ns}"><location ref="A1:B5"/></pivotTableDefinition>` }] };
  check('My data has a header').checked = header; wb.clearHistory(); const before = wb.toJSON();
  submit(); expect(wb.toJSON()).toEqual(before); expect(wb.canUndo()).toBe(false);
  expect(open()).toBe(true); expect(alert.textContent).toMatch(/overlaps a pivot table/); expect(wb.tablesOn(id)).toHaveLength(0);
});

it.each([[false, false], [true, false], [false, true], [true, true]])('checks totals-row report conflicts before changing the sheet (header row: %s, ordinary content: %s)', (header, ordinary) => {
  const { wb, id, alert, submit, check, rangeInput } = setup();
  const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  wb.nativePivots = { version: 1, caches: [{ key: 'cache', xml: `<pivotCacheDefinition xmlns="${ns}"/>` }],
    tables: ['A3:B4', 'D2:E4'].map((ref, i) => ({ name: `Report${i}`, owner: id, cache: 'cache', ref,
      xml: `<pivotTableDefinition xmlns="${ns}"><location ref="${ref}"/></pivotTableDefinition>` })) };
  if (ordinary) wb.nativePivots.tables.shift(); // Existing A3:B3 cells still require room for totals.
  rangeInput.value = 'A1:B2'; check('My data has a header').checked = header; check('Totals row').checked = true;
  wb.clearHistory(); const before = wb.toJSON(); submit();
  expect(wb.toJSON()).toEqual(before); expect(wb.canUndo()).toBe(false);
  expect(alert.textContent).toMatch(/would split a pivot table/);
});
