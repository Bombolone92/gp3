// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { openFormatCellsDialog } from '../src/ui/formatcells.js';
import { closeAllModals } from '../src/ui/modal.js';

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  document.body.innerHTML = '<div id="app"></div>';
});
afterEach(() => { closeAllModals(); vi.runAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

// A cell whose custom code the Negative numbers choice recognises opened on Number, and switching the
// category to Custom then showed an empty code field: Apply asked for a format code the cell already had.
function open(code) {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '-1234.5');
  wb.applyStyle(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, { fmt: 'custom', code });
  const run = vi.fn();
  const { panel } = openFormatCellsDialog({ wb, sheetId: () => id, active: () => ({ r: 0, c: 0 }), style: () => wb.getCell(id, 0, 0).s, run, grid: { focus() {} } });
  const field = (label) => panel.querySelector(`[aria-label="${label}"]`);
  const choose = (label, value) => { field(label).value = value; field(label).dispatchEvent(new Event('change')); };
  return { panel, field, choose, run, submit: () => panel.querySelector('form').requestSubmit() };
}

it('shows the cell\'s own code under Custom, and applies nothing when it is left as it is', () => {
  const code = '#,##0.00;[Red]-#,##0.00';
  const { panel, field, choose, run, submit } = open(code);
  expect(field('Category').value).toBe('number');
  expect(field('Negative numbers').value).toBe('red');
  choose('Category', 'custom');
  expect(field('Format code').value).toBe(code);
  expect(panel.querySelector('.numfmt-preview').textContent).toBe('Preview: -1,234.50');
  submit();
  expect(panel.querySelector('.field-error').hidden).toBe(true);
  expect(run).not.toHaveBeenCalled();
});

it('applies an edited code from there', () => {
  const { field, choose, run, submit } = open('#,##0.00;[Red]-#,##0.00');
  choose('Category', 'custom');
  field('Format code').value = '0.0;[Red](0.0)';
  field('Format code').dispatchEvent(new Event('input'));
  submit();
  expect(run).toHaveBeenCalledWith('applyFormat', expect.objectContaining({ patch: expect.objectContaining({ fmt: 'custom', code: '0.0;[Red](0.0)' }) }));
});

it('still applies the Number category\'s own negative style when that is what changes', () => {
  const { choose, run, submit } = open('#,##0.00;[Red]-#,##0.00');
  choose('Negative numbers', 'paren');
  submit();
  expect(run).toHaveBeenCalledWith('applyFormat', expect.objectContaining({ patch: expect.objectContaining({ fmt: 'custom', code: '#,##0.00;(#,##0.00)' }) }));
});
