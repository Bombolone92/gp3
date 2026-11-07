// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook, MAX_ROWS } from '../src/core/workbook.js';
import { openSubtotalDialog } from '../src/ui/subtotaldialog.js';
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

function open(wb, range) {
  return openSubtotalDialog({ wb, sheetId: () => wb.activeSheetId, grid: { focus: vi.fn(), setSelection: vi.fn() } }, range);
}

const selectedColumns = () => [...document.querySelectorAll('input[data-col]')].filter((input) => input.checked).map((input) => Number(input.dataset.col));

it('opens subtotal options for sparse full columns without reading every empty row', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, 'Category');
  wb.setInput(id, 0, 1, 'Amount');
  wb.setInput(id, 1, 0, 'Sales');
  wb.setInput(id, 1, 1, '5');
  wb.setInput(id, MAX_ROWS - 1, 1, '10');
  const before = wb.toJSON();
  const getValue = wb.getValue.bind(wb);
  let reads = 0;
  vi.spyOn(wb, 'getValue').mockImplementation((...args) => {
    if (++reads > 100) throw new Error('Subtotal options scan empty rows before opening');
    return getValue(...args);
  });
  const modal = open(wb, { r1: 0, c1: 0, r2: MAX_ROWS - 1, c2: 1 });
  expect(modal.panel.getAttribute('aria-label')).toBe('Subtotals');
  expect(document.querySelector('[aria-label="At each change in"]').value).toBe('0');
  expect(selectedColumns()).toEqual([1]);
  expect(wb.toJSON()).toEqual(before);
});

it.each(['sparse', 'dense'])('preserves suggestions and undo for dates, errors, blanks, and spills on a %s sheet', (density) => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  ['Category', 'Amount', 'Date', 'Mixed', 'Empty'].forEach((value, c) => wb.setInput(id, 0, c, value));
  wb.setInput(id, 1, 0, 'Sales');
  wb.setInput(id, 1, 1, '=SEQUENCE(3)');
  wb.applyStyle(id, { r1: 2, c1: 1, r2: 2, c2: 1 }, { bold: true });
  wb.setInput(id, 4, 1, 'text');
  wb.setInput(id, 5, 1, 'text');
  wb.setInput(id, 1, 2, '2026-01-01');
  if (density === 'dense') wb.applyStyle(id, { r1: 1, c1: 2, r2: 1, c2: 2 }, { fmt: 'custom', code: 'dd/mm/yyyy' });
  wb.setInput(id, 1, 3, '4');
  wb.setInput(id, 2, 3, '=1/0');
  wb.setInput(id, 3, 3, 'text');
  wb.setInput(id, 1, 4, '=""');
  wb.setInput(id, 6, 3, '5'); // outside the selected rows
  if (density === 'dense') for (let r = 10; r < 50; r++) wb.setInput(id, r, 0, 'Outside selection');
  const range = { r1: 0, c1: 0, r2: 5, c2: 4 };
  open(wb, range);
  expect(selectedColumns()).toEqual([1]);
  document.querySelector('form').requestSubmit();
  expect([...wb.activeSheet.cells.values()].some((cell) => cell.f?.startsWith('SUBTOTAL('))).toBe(true);
  wb.undo();
  expect(wb.getValue(id, 1, 1)).toBe(1);
  expect(wb.getValue(id, 3, 1)).toBe(3);
});
