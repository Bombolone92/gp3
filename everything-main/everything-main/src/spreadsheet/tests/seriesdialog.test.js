// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { openSeriesDialog } from '../src/ui/seriesdialog.js';
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
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

function setup(type) {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  for (const [r, value] of [1, 8, 9].entries()) wb.setInput(id, r, 0, String(value));
  wb.clearHistory();
  openSeriesDialog({ wb, sheetId: () => id, range: () => ({ r1: 0, c1: 0, r2: 2, c2: 0 }), grid: { setSelection: vi.fn(), focus: vi.fn() } });
  const panel = document.querySelector('.modal-panel');
  panel.querySelector('[aria-label="Type"]').value = type;
  return { wb, id, panel, step: panel.querySelector('[aria-label="Step"]') };
}

it('defaults to a date series for an imported custom date format', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '2024-01-15');
  wb.applyStyle(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, { fmt: 'custom', code: 'dd/mm/yyyy' });
  openSeriesDialog({ wb, sheetId: () => id, range: () => ({ r1: 0, c1: 0, r2: 2, c2: 0 }), grid: { setSelection() {}, focus() {} } });
  expect(document.querySelector('[aria-label="Type"]').value).toBe('date');
  document.querySelector('form').requestSubmit();
  expect(wb.getDisplay(id, 2, 0)).toBe('17/01/2024');
});

it.each(['linear', 'date', 'growth'])('keeps existing data when a %s series has an empty step', (type) => {
  const { wb, panel, step } = setup(type);
  const before = wb.toJSON();
  step.value = '';
  panel.querySelector('button[type="submit"]').focus();
  panel.querySelector('form').requestSubmit();
  expect(wb.toJSON()).toEqual(before);
  expect(wb.undoLabels()).toEqual([]);
  expect(panel.closest('.modal-root').classList.contains('closing')).toBe(false);
  expect(panel.querySelector('[role="alert"]').hidden).toBe(false);
  expect(document.activeElement).toBe(step);
  step.value = '2';
  panel.querySelector('form').requestSubmit();
  expect(wb.undoLabels()).toHaveLength(1);
});

it('still accepts an explicitly entered zero step for a constant linear series', () => {
  const { wb, id, panel, step } = setup('linear');
  step.value = '0';
  panel.querySelector('form').requestSubmit();
  expect([0, 1, 2].map((r) => wb.getValue(id, r, 0))).toEqual([1, 1, 1]);
  expect(wb.undoLabels()).toHaveLength(1);
  wb.undo();
  expect([0, 1, 2].map((r) => wb.getValue(id, r, 0))).toEqual([1, 8, 9]);
});
