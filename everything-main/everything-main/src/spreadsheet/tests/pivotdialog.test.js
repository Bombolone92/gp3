// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';
import * as S from '../src/core/selection.js';
import { openPivotDialog } from '../src/ui/pivotdialog.js';
import * as pivot from '../src/core/pivot.js';
import { closeAllModals } from '../src/ui/modal.js';

vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  document.body.innerHTML = '<div id="app"></div>';
});
afterEach(() => {
  closeAllModals();
  vi.runAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

function setup(name) {
  const wb = new Workbook({ sheets: [{ name }] });
  const id = wb.activeSheetId;
  [['Region', 'Amount'], ['East', '10'], ['West', '20']].forEach((row, r) =>
    row.forEach((value, c) => wb.setInput(id, r, c, value)));
  wb.clearHistory();
  const range = parseRange('A1:B3');
  const ctx = { wb, sheetId: () => id, range: () => range, selection: () => S.fromRange(range), grid: { focus: vi.fn() } };
  return { wb, id, ctx };
}

it('previews dimensions without generating output cells until insertion', () => {
  const { wb, ctx } = setup('Sales');
  const generate = vi.spyOn(pivot, 'buildPivot');
  const { panel } = openPivotDialog(ctx);
  expect(panel.querySelector('.field-hint').textContent).toContain('2 rows, sum of Amount');
  const agg = panel.querySelector('[aria-label="Summarize by"]');
  agg.value = 'average';
  agg.dispatchEvent(new Event('change'));
  expect(panel.querySelector('.field-hint').textContent).toContain('2 rows, average of Amount');
  expect(generate).not.toHaveBeenCalled();
  expect(wb.sheets).toHaveLength(1);
  panel.querySelector('form').requestSubmit();
  expect(generate).toHaveBeenCalledTimes(1);
  expect(wb.getValue(wb.sheets[1].id, 3, 1)).toBe(15);
});

it.each(['Sales', 'Quarterly financial projections'])('creates repeated pivots from %s with unique valid names', (name) => {
  const { wb, id, ctx } = setup(name);
  const lookup = wb.sheetByName.bind(wb);
  let lookups = 0;
  // Stop a broken naming loop without hanging the test worker.
  vi.spyOn(wb, 'sheetByName').mockImplementation((candidate) => ++lookups > 1000 ? undefined : lookup(candidate));
  for (let i = 0; i < 11; i++) {
    const { panel } = openPivotDialog(ctx);
    panel.querySelector('form').requestSubmit();
  }
  expect(lookups).toBeLessThan(1000);
  expect(wb.sheets).toHaveLength(12);
  expect(new Set(wb.sheets.map((sheet) => sheet.name.toLowerCase())).size).toBe(12);
  for (const sheet of wb.sheets.slice(1)) {
    expect(sheet.name.length).toBeLessThanOrEqual(31);
    expect(wb.getValue(sheet.id, 3, 1)).toBe(30);
  }
  wb.setInput(id, 1, 1, '15');
  expect(wb.getValue(wb.sheets[1].id, 3, 1)).toBe(35);
  wb.undo();
  wb.undo();
  expect(wb.sheets).toHaveLength(11);
  wb.redo();
  expect(wb.sheets).toHaveLength(12);
});

it('keeps an explicitly chosen value field when it also groups the rows', () => {
  const { wb, id, ctx } = setup('Sales');
  wb.setInput(id, 0, 0, 'Units');
  wb.setInput(id, 1, 0, '1');
  wb.setInput(id, 2, 0, '2');
  const { panel } = openPivotDialog(ctx);
  const values = panel.querySelector('[aria-label="Values"]');
  expect(values.value).toBe('1'); // Initially guess the other numeric column.
  values.value = '0';
  values.dispatchEvent(new Event('change'));
  expect(values.value).toBe('0');
  const agg = panel.querySelector('[aria-label="Summarize by"]');
  agg.value = 'max';
  agg.dispatchEvent(new Event('change'));
  expect(values.value).toBe('0');
  panel.querySelector('form').requestSubmit();
  const pivot = wb.sheets[1];
  expect(wb.getValue(pivot.id, 0, 1)).toBe('Max of Units');
  expect(wb.getValue(pivot.id, 3, 1)).toBe(2);
});

function setupFilters() {
  const { wb, id, ctx } = setup('Sales');
  [['Quarter', 'Channel'], ['Q2', 'Retail'], ['Q3', 'Wholesale'], ['Q1', 'Direct']]
    .forEach((row, r) => row.forEach((value, c) => wb.setInput(id, r, c + 2, value)));
  wb.setInput(id, 3, 0, 'East');
  wb.setInput(id, 3, 1, '30');
  ctx.range = () => parseRange('A1:D3');
  ctx.selection = () => S.fromRange(ctx.range());
  const { panel } = openPivotDialog(ctx);
  const field = panel.querySelector('[aria-label="Filter by"]');
  const showing = panel.querySelector('[aria-label="Showing"]');
  const change = (input, value, event = 'change') => {
    input.value = value;
    input.dispatchEvent(new Event(event));
  };
  change(field, '2');
  change(showing, '0'); // Q2
  return { wb, panel, field, showing, change };
}

it('distinguishes a category named (All) in both filter controls', () => {
  const { wb, id, ctx } = setup('Sales');
  ['Category', '(All)', 'Other'].forEach((v, r) => wb.setInput(id, r, 2, v));
  ctx.range = () => parseRange('A1:C3');
  ctx.selection = () => S.fromRange(ctx.range());
  const { panel } = openPivotDialog(ctx);
  const field = panel.querySelector('[aria-label="Filter by"]');
  field.value = '2';
  field.dispatchEvent(new Event('change'));
  const showing = panel.querySelector('[aria-label="Showing"]');
  const labels = [...showing.options].map((option) => option.textContent);
  expect(new Set(labels).size).toBe(labels.length);
  const all = showing.options[0].textContent;
  showing.value = [...showing.options].find((option) => option.textContent === '(All)').value;
  showing.dispatchEvent(new Event('change'));
  panel.querySelector('form').requestSubmit();
  const pivot = wb.sheets[1];
  expect(wb.getValue(pivot.id, 5, 1)).toBe(10);
  expect(pivot.validations[0].source).toEqual([all, '(All)', 'Other']);
  expect(pivot.validations[0].prompt).toContain(all);
  wb.setInput(pivot.id, 0, 1, all);
  expect(wb.getValue(pivot.id, 5, 1)).toBe(30);
});

it('preserves the selected pivot filter value when extending the source reorders its options', () => {
  const { wb, panel, showing, change } = setupFilters();
  expect(showing.selectedOptions[0].textContent).toBe('Q2');
  change(panel.querySelector('[aria-label="Source range"]'), 'A1:D4', 'input');
  expect(showing.selectedOptions[0].textContent).toBe('Q2');
  panel.querySelector('form').requestSubmit();
  const pivot = wb.sheets[1];
  expect(wb.getValue(pivot.id, 0, 1)).toBe('Q2');
  expect(wb.getValue(pivot.id, 3, 1)).toBe(10);
  expect(wb.getValue(pivot.id, 5, 1)).toBe(10);
});

it('resets the pivot filter to All when changing to another field', () => {
  const { wb, panel, field, showing, change } = setupFilters();
  change(field, '3');
  expect(showing.selectedOptions[0].textContent).toBe('(All)');
  panel.querySelector('form').requestSubmit();
  expect(wb.getValue(wb.sheets[1].id, 0, 1)).toBe('(All)');
  expect(wb.getValue(wb.sheets[1].id, 5, 1)).toBe(30);
});

it('resets a removed pivot filter value instead of choosing the item now at its index', () => {
  const { panel, showing, change } = setupFilters();
  change(panel.querySelector('[aria-label="Source range"]'), 'A2:D4', 'input');
  expect(showing.selectedOptions[0].textContent).toBe('(All)');
});

it('preserves the exact filter label when options differ only by surrounding whitespace', () => {
  const { wb, id, ctx } = setup('Sales');
  wb.setCells(id, [
    { r: 0, c: 2, cell: { v: 'Category', f: null } },
    { r: 1, c: 2, cell: { v: 'East', f: null } },
    { r: 2, c: 2, cell: { v: ' East', f: null } },
  ]);
  ctx.range = () => parseRange('A1:C3');
  ctx.selection = () => S.fromRange(ctx.range());
  const { panel } = openPivotDialog(ctx);
  const field = panel.querySelector('[aria-label="Filter by"]');
  field.value = '2';
  field.dispatchEvent(new Event('change'));
  const showing = panel.querySelector('[aria-label="Showing"]');
  const option = [...showing.options].find((o) => o.textContent === 'East');
  showing.value = option.value;
  showing.dispatchEvent(new Event('change'));
  expect(showing.selectedOptions[0].textContent).toBe('East');
  panel.querySelector('form').requestSubmit();
  expect(wb.getValue(wb.sheets[1].id, 0, 1)).toBe('East');
  expect(wb.getValue(wb.sheets[1].id, 5, 1)).toBe(10);
});

it('explains oversized output without creating a partial pivot and allows correcting the fields', () => {
  const { wb, id, ctx } = setup('Sales');
  wb.setCells(id, [
    { r: 0, c: 2, cell: { v: 'Category' } },
    ...Array.from({ length: 16384 }, (_, i) => [
      { r: i + 1, c: 0, cell: { v: 'East' } },
      { r: i + 1, c: 1, cell: { v: 1 } },
      { r: i + 1, c: 2, cell: { v: `Category ${i}` } },
    ]).flat(),
  ]);
  ctx.range = () => parseRange('A1:C16385');
  ctx.selection = () => S.fromRange(ctx.range());
  const { panel } = openPivotDialog(ctx);
  const columns = panel.querySelector('[aria-label="Columns"]');
  columns.value = '2';
  columns.dispatchEvent(new Event('change'));
  expect(panel.querySelector('.field-error').hidden).toBe(false);
  expect(panel.querySelector('.field-error').textContent).toMatch(/16386 columns/);
  const before = wb.toJSON();
  const history = wb.undoLabels();
  panel.querySelector('form').requestSubmit();
  expect(wb.toJSON()).toEqual(before);
  expect(wb.undoLabels()).toEqual(history);
  columns.value = '';
  columns.dispatchEvent(new Event('change'));
  expect(panel.querySelector('.field-error').hidden).toBe(true);
  panel.querySelector('form').requestSubmit();
  expect(wb.sheets).toHaveLength(2);
  expect(wb.getValue(wb.sheets[1].id, 2, 1)).toBe(16384);
  wb.undo();
  expect(wb.sheets).toHaveLength(1);
});

it('preserves exact category values in generated filter dropdowns and saved files', async () => {
  vi.stubGlobal('Blob', (await import('node:buffer')).Blob);
  const { workbookToXlsx, workbookFromFile } = await import('../src/core/io.js');
  const { wb, id, ctx } = setup('Sales');
  const categories = ['Acme, Inc.', 'Line\nBreak', ' East ', 1234567890123, 'Alpha 00123'];
  wb.setCells(id, [
    { r: 0, c: 2, cell: { v: 'Category' } },
    ...categories.flatMap((v, i) => [
      { r: i + 1, c: 0, cell: { v: 'East' } },
      { r: i + 1, c: 1, cell: { v: i + 1 } },
      { r: i + 1, c: 2, cell: { v } },
    ]),
  ]);
  ctx.range = () => parseRange('A1:C6');
  ctx.selection = () => S.fromRange(ctx.range());
  const { panel } = openPivotDialog(ctx);
  const filter = panel.querySelector('[aria-label="Filter by"]');
  filter.value = '2';
  filter.dispatchEvent(new Event('change'));
  panel.querySelector('form').requestSubmit();
  const verify = (book) => {
    const sheet = book.sheets[1];
    const rule = sheet.validations[0];
    const values = book.listOptionsFor(sheet.id, rule, { typed: true });
    expect(values).toEqual(expect.arrayContaining(['(All)', ...categories]));
    expect(values).toHaveLength(categories.length + 1);
    for (const [i, value] of categories.entries()) {
      book.setInput(sheet.id, 0, 1, value, { literal: true });
      expect(book.getValue(sheet.id, 3, 1)).toBe(i + 1);
    }
  };
  verify(wb);
  verify(await workbookFromFile(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), 'pivot.xlsx'));
});
