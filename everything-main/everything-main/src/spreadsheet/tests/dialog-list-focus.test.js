// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';
import { openConditionalFormatting } from '../src/ui/condformat.js';
import { openValidationManager } from '../src/ui/validation.js';
import { openNamesManager } from '../src/ui/names.js';
import { openProtectedRanges } from '../src/ui/protect.js';
import { openSortDialog } from '../src/ui/sortdialog.js';
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

function ctxFor(wb, range = parseRange('A1:A5')) {
  return { wb, sheetId: () => wb.activeSheetId, range: () => range, active: () => ({ r: range.r1, c: range.c1 }), grid: { focus: vi.fn(), range }, run: vi.fn() };
}
/** Focuses the control with `label` and clicks it, as a keyboard user does. */
function press(panel, label) {
  const button = panel.querySelector(`[aria-label="${label}"]`);
  button.focus();
  button.click();
}
const focused = () => document.activeElement.getAttribute('aria-label');

// Each list action rebuilt the rows and left the focus on the page body, so a keyboard user had to
// find the way back into the dialog after every delete, move, unprotect, or conversion.
it('keeps the focus in the conditional-format list after a rule is deleted or moved, then on the range field', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  // Different conditions remain separate editable groups.
  for (const [index, col] of ['A', 'B', 'C'].entries()) wb.addRule(id, { range: parseRange(`${col}1:${col}5`), type: 'gt', value: index + 1, style: { bg: '#fef3c7' } });
  const { panel } = openConditionalFormatting(ctxFor(wb));
  press(panel, 'Delete rule for A1:A5');
  expect(focused()).toBe('Delete rule for B1:B5');
  press(panel, 'Move the rule for B1:B5 down');
  expect(wb.sheet(id).rules.map((rule) => rule.range.c1)).toEqual([2, 1]);
  expect(focused()).toBe('Move the rule for B1:B5 up');
  press(panel, 'Move the rule for B1:B5 up');
  expect(focused()).toBe('Move the rule for B1:B5 down');
  press(panel, 'Delete rule for C1:C5');
  expect(focused()).toBe('Delete rule for B1:B5');
  press(panel, 'Delete rule for B1:B5');
  expect(focused()).toBe('Apply to range');
});

it('keeps the focus in the validation list after a rule is deleted, then on the range field', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  for (const col of ['A', 'B']) wb.addValidation(id, { range: parseRange(`${col}1:${col}5`), type: 'list', source: 'Yes, No' });
  const { panel } = openValidationManager(ctxFor(wb));
  press(panel, 'Delete rule for A1:A5');
  expect(focused()).toBe('Delete rule for B1:B5');
  press(panel, 'Delete rule for B1:B5');
  expect(focused()).toBe('Apply to range');
});

it('keeps the focus in the names list after a table is converted or a name deleted, then on New name', () => {
  const wb = new Workbook({ names: [{ name: 'Rate', ref: '10' }, { name: 'Tax', ref: '0.2' }] });
  const id = wb.activeSheetId;
  wb.addTable(id, parseRange('A1:B4'), { name: 'Stock' });
  const ctx = ctxFor(wb);
  openNamesManager(ctx);
  const panel = document.querySelector('.modal-panel');
  press(panel, 'Convert Stock to a plain range');
  expect(focused()).toBe('Delete Rate');
  press(panel, 'Delete Rate');
  expect(focused()).toBe('Delete Tax');
  press(panel, 'Delete Tax');
  expect(focused()).toBe('New name');
});

it('keeps the focus in the protected-ranges list after one is unprotected, then on the range field', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.protectRange(id, parseRange('A1:A5'));
  wb.protectRange(id, parseRange('B1:B5'));
  const { panel } = openProtectedRanges(ctxFor(wb));
  press(panel, 'Unprotect A1:A5');
  expect(focused()).toBe('Unprotect B1:B5');
  press(panel, 'Unprotect B1:B5');
  expect(focused()).toBe('Range');
});

it('keeps the focus on the next sort level when one is removed, then on the add button', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) wb.setInput(id, r, c, String((r * 7 + c) % 5));
  const { panel } = openSortDialog(ctxFor(wb, parseRange('A1:C5')), parseRange('A1:C5'));
  const add = [...panel.querySelectorAll('button')].find((button) => button.textContent.includes('Add another level'));
  add.click();
  add.click();
  const removes = () => [...panel.querySelectorAll('[aria-label="Remove this level"]')];
  expect(removes()).toHaveLength(3);
  removes()[0].focus();
  removes()[0].click();
  expect(removes()).toHaveLength(2);
  expect(document.activeElement).toBe(removes()[0]);
  removes()[1].focus();
  removes()[1].click();
  expect(document.activeElement).toBe(removes()[0]);
  removes()[0].focus();
  removes()[0].click();
  expect(document.activeElement).toBe(add);
});
