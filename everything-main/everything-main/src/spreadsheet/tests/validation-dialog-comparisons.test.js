// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { openValidationManager } from '../src/ui/validation.js';
import { closeAllModals } from '../src/ui/modal.js';
vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));
beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('matchMedia', () => ({ matches: true })); document.body.innerHTML = '<div id="app"></div>'; });
afterEach(() => { closeAllModals(); vi.runAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); document.body.replaceChildren(); });
function setup(rule) {
  const wb = new Workbook(), id = wb.activeSheetId, range = { r1: 1, c1: 0, r2: 3, c2: 0 };
  if (rule) wb.addValidation(id, { range, ...rule }); wb.clearHistory();
  const { panel } = openValidationManager({ wb, sheetId: () => id, range: () => range });
  const field = label => panel.querySelector(`[aria-label="${label}"]`);
  const choose = (label, value) => { field(label).value = value; field(label).dispatchEvent(new Event('change')); };
  return { wb, id, panel, field, choose, save: () => panel.querySelector('form').requestSubmit() };
}
it('creates a single-bound whole-number comparison and rejects decimals, with one-step Undo', () => {
  const { wb, id, panel, field, choose, save } = setup(); choose('Type', 'whole'); choose('Comparison', 'greaterThan'); field('Comparison value').value = '2';
  expect(field('Maximum').hidden).toBe(true); save();
  expect(wb.validationAt(id, 1, 0)).toMatchObject({ type: 'whole', operator: 'greaterThan', min: 2 });
  expect(wb.validateValue(id, 1, 0, 3).ok).toBe(true); expect(wb.validateValue(id, 1, 0, 2.5).ok).toBe(false);
  expect(panel.querySelector('summary').textContent).toContain('(1)'); wb.undo(); expect(wb.activeSheet.validations).toHaveLength(0);
});
it('requires both bounds for a new time range and accepts clock input', () => {
  const { wb, id, panel, field, choose, save } = setup(); choose('Type', 'time'); field('Earliest time').value = '09:00'; save();
  expect(wb.activeSheet.validations).toHaveLength(0); expect(document.activeElement).toBe(field('Latest time'));
  field('Latest time').value = '17:00'; save(); expect(wb.validationAt(id, 1, 0)).toMatchObject({ type: 'time', min: 9 / 24, max: 17 / 24 });
  expect(wb.validateInput(id, 1, 0, '12:30').ok).toBe(true); expect(wb.validateInput(id, 1, 0, '18:00').ok).toBe(false);
});
it('retains hidden second-bound drafts and ignores their invalid input for a unary comparison', () => {
  const { wb, id, field, choose, save } = setup(); choose('Type', 'number'); field('Minimum').value = '2'; field('Maximum').value = '7';
  Object.defineProperty(field('Maximum'), 'validity', { configurable: true, value: { badInput: true } });
  choose('Comparison', 'greaterThan'); expect(field('Maximum').value).toBe('7'); save(); expect(wb.validationAt(id, 1, 0)).toMatchObject({ operator: 'greaterThan', min: 2 });
  expect(wb.validationAt(id, 1, 0).max).toBeUndefined();
});
it('reveals the Time field after refusing an unreadable time from another tab', () => {
  const { wb, panel, field, choose, save } = setup(); choose('Type', 'time'); choose('Comparison', 'equal'); field('Comparison time').value = 'not a time';
  panel.querySelector('[role="tab"][data-key="error"]').click(); save(); expect(wb.activeSheet.validations).toHaveLength(0);
  expect(panel.querySelector('[role="tab"][data-key="settings"]').getAttribute('aria-selected')).toBe('true'); expect(document.activeElement).toBe(field('Comparison time'));
});
it('preserves subsecond time bounds and explicit operator spelling on untouched saves', () => {
  const { wb, panel, field, save } = setup({ type: 'time', operator: 'between', min: .375000000001, max: 1.5, prompt: 'Clock' });
  panel.querySelector('.names-main').click(); const before = wb.toJSON(), version = wb.version; expect(field('Latest time').value).toBe('1.5'); save();
  expect(wb.toJSON()).toEqual(before); expect(wb.version).toBe(version);
});
it('preserves a legacy bound-free decimal rule and still permits optional bounds', () => {
  const { wb, panel, choose, save } = setup({ type: 'number' }); panel.querySelector('.names-main').click(); const before = wb.toJSON(), version = wb.version; save();
  expect(wb.toJSON()).toEqual(before); expect(wb.version).toBe(version);
  choose('Type', 'number'); save(); expect(wb.activeSheet.validations[0]).toMatchObject({ type: 'number' });
});
it('creates an Any Value message with the blank-policy control disabled', () => {
  const { wb, id, panel, field, choose, save } = setup(); const blank = panel.querySelector('[role="tabpanel"][data-key="settings"] > label.find-option input'); blank.click(); choose('Type', 'any'); expect(blank.disabled).toBe(true); expect(blank.checked).toBe(true);
  panel.querySelector('[role="tab"][data-key="prompt"]').click(); field('Input message').value = 'Enter any value'; save();
  expect(wb.validationAt(id, 1, 0)).toMatchObject({ type: 'any', prompt: 'Enter any value' }); expect(wb.validateValue(id, 1, 0, '').ok).toBe(true);
});
