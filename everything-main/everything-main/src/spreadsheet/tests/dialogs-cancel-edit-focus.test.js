// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { openConditionalFormatting } from '../src/ui/condformat.js';
import { openValidationManager } from '../src/ui/validation.js';
import { openProtectedRanges } from '../src/ui/protect.js';
import { closeAllModals } from '../src/ui/modal.js';

vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  document.body.innerHTML = '<div id="app"></div>';
});
afterEach(() => { closeAllModals(); vi.runAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

// Cancel edit hides itself: pressed from the keyboard, it dropped the focus to the page, and the next Tab
// started over from the top of the dialog. Named ranges already sent it to the form's first field.
const panel = () => document.querySelector('.modal-panel');
const cancelEdit = () => [...panel().querySelectorAll('button')].find((b) => b.textContent === 'Cancel edit');
const dataRange = { r1: 1, c1: 1, r2: 3, c2: 1 };
const grid = () => ({ focus: vi.fn(), setSelection: vi.fn() });
function workbook() {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  [['Item', 'Amount'], ['A', '10'], ['B', '20']].forEach((row, r) => row.forEach((v, c) => wb.setInput(id, r, c, v)));
  return { wb, id };
}

it.each([
  ['Conditional formatting', 'Apply to range', (wb, id) => { wb.addRule(id, { range: dataRange, type: 'gt', value: 10, style: { bg: '#fef3c7' } }); openConditionalFormatting({ wb, sheetId: () => id, range: () => dataRange, grid: grid() }); }],
  ['Data validation', 'Apply to range', (wb, id) => { wb.addValidation(id, { range: dataRange, type: 'list', source: 'a, b' }); openValidationManager({ wb, sheetId: () => id, range: () => dataRange, grid: grid() }); }],
  ['Protected ranges', 'Range', (wb, id) => { wb.protectRange(id, { r1: 0, c1: 3, r2: 4, c2: 3 }, ''); openProtectedRanges({ wb, sheetId: () => id, range: () => dataRange, grid: grid() }); }],
])('%s: Cancel edit hands the focus to the range field', (_, label, open) => {
  const { wb, id } = workbook();
  open(wb, id);
  panel().querySelector('.names-main').click();
  const cancel = cancelEdit();
  expect(cancel.hidden).toBe(false);
  cancel.focus();
  cancel.click();
  expect(cancel.hidden).toBe(true);
  expect(document.activeElement).toBe(panel().querySelector(`[aria-label="${label}"]`));
});
