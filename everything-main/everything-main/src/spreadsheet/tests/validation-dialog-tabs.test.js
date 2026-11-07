// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { openValidationManager } from '../src/ui/validation.js';
import { closeAllModals } from '../src/ui/modal.js';
vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal('matchMedia', () => ({ matches: true }));
  document.body.innerHTML = '<div id="app"></div>';
});
afterEach(() => { closeAllModals(); vi.runAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); document.body.replaceChildren(); });
function setup(rule) {
  const wb = new Workbook(), id = wb.activeSheetId, range = { r1: 1, c1: 0, r2: 3, c2: 0 };
  if (rule) wb.addValidation(id, { range, type: 'list', source: 'Ready, Waiting, Done', ...rule });
  wb.clearHistory();
  const { panel } = openValidationManager({ wb, sheetId: () => id, range: () => range });
  const field = label => panel.querySelector(`[aria-label="${label}"]`);
  const tab = key => panel.querySelector(`[role="tab"][data-key="${key}"]`);
  return { wb, id, panel, field, tab, save: () => panel.querySelector('form').requestSubmit() };
}
it('keeps drafts across tabs and saves titles, multiline messages and warning behavior in one undo step', () => {
  const { wb, id, field, tab, save } = setup();
  field('List options').value = 'Ready, Waiting, Done';
  tab('prompt').click(); field('Input message title').value = 'Status'; field('Input message').value = 'Choose a status\nfrom this list.';
  tab('error').click(); const reject = document.querySelector('[data-key="error"][role="tabpanel"] input[type="checkbox"]'); reject.click();
  field('Invalid entry alert').value = 'warning'; field('Error alert title').value = 'Check status'; field('Help message').value = 'Choose Ready, Waiting or Done';
  tab('settings').click(); expect(field('List options').value).toBe('Ready, Waiting, Done'); save();
  expect(wb.validationAt(id, 1, 0)).toMatchObject({ promptTitle: 'Status', prompt: 'Choose a status\nfrom this list.', errorTitle: 'Check status', strict: false, errorStyle: 'warning', showErrorMessage: true });
  expect(wb.validateValue(id, 1, 0, 'Other').ok).toBe(false);
  wb.undo(); expect(wb.activeSheet.validations).toHaveLength(0);
});
it('retains disabled message contents and imported titles on an untouched save', () => {
  const { wb, panel, field, tab, save } = setup({ promptTitle: ' Status ', prompt: 'Stored message', showInputMessage: false, errorTitle: ' Check ', strict: false, errorStyle: 'information', showErrorMessage: true });
  panel.querySelector('.names-main').click(); const before = wb.toJSON(), version = wb.version;
  tab('prompt').click(); expect(field('Input message').disabled).toBe(true); expect(field('Input message title').value).toBe(' Status ');
  save(); expect(wb.toJSON()).toEqual(before); expect(wb.version).toBe(version);
});
it('reenables a stored message without losing its contents and Undo restores its visibility', () => {
  const { wb, id, panel, field, tab, save } = setup({ promptTitle: 'Status', prompt: 'Stored message', showInputMessage: false });
  panel.querySelector('.names-main').click(); tab('prompt').click(); panel.querySelector('[data-key="prompt"][role="tabpanel"] input[type="checkbox"]').click();
  expect(field('Input message').disabled).toBe(false); save();
  expect(wb.validationAt(id, 1, 0).showInputMessage).not.toBe(false);
  expect(wb.validationAt(id, 1, 0).prompt).toBe('Stored message'); wb.undo(); expect(wb.validationAt(id, 1, 0).showInputMessage).toBe(false);
});
it('reveals and focuses an invalid settings field when submitted from another tab', () => {
  const { panel, field, tab, save } = setup(); tab('error').click(); save();
  expect(tab('settings').getAttribute('aria-selected')).toBe('true'); expect(document.activeElement).toBe(field('List options'));
  expect(panel.querySelector('.field-error').textContent).toContain('Enter the list options');
});
it('checks unreadable bounds even while the settings panel is hidden', () => {
  const { field, tab, save } = setup(); field('Type').value = 'number'; field('Type').dispatchEvent(new Event('change'));
  Object.defineProperty(field('Minimum'), 'validity', { value: { badInput: true }, configurable: true });
  tab('prompt').click(); save(); expect(tab('settings').getAttribute('aria-selected')).toBe('true'); expect(document.activeElement).toBe(field('Minimum'));
});
it('uses roving tab focus, wraparound and panel entry while leaving modified and composition keys alone', () => {
  const { panel, tab } = setup(); const key = (target, value, extra = {}) => target.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, ...extra }));
  tab('settings').focus(); key(tab('settings'), 'ArrowLeft'); expect(document.activeElement).toBe(tab('error'));
  key(tab('error'), 'Home'); expect(document.activeElement).toBe(tab('settings')); key(tab('settings'), 'End'); expect(document.activeElement).toBe(tab('error'));
  key(tab('error'), 'ArrowRight', { ctrlKey: true }); key(tab('error'), 'ArrowRight', { isComposing: true }); expect(tab('error').getAttribute('aria-selected')).toBe('true');
  key(tab('error'), 'ArrowDown'); expect(document.activeElement).toBe(panel.querySelector('[role="tabpanel"][data-key="error"] input'));
  expect([...panel.querySelectorAll('[role="tab"]')].filter(t => t.tabIndex === 0)).toEqual([tab('error')]);
});
it('disables message tabs for checkboxes and keeps tab navigation on settings', () => {
  const { field, tab } = setup(); field('Type').value = 'checkbox'; field('Type').dispatchEvent(new Event('change'));
  expect(tab('prompt').disabled).toBe(true); expect(tab('error').disabled).toBe(true);
  tab('settings').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); expect(tab('settings').getAttribute('aria-selected')).toBe('true');
});
it('shows Stop for rejection and retains a warning draft when rejection is toggled', () => {
  const { panel, field, tab } = setup({ strict: false, errorStyle: 'warning', showErrorMessage: true });
  panel.querySelector('.names-main').click(); tab('error').click();
  const reject = panel.querySelector('[role="tabpanel"][data-key="error"] input');
  expect(field('Invalid entry alert').value).toBe('warning');
  reject.click(); expect(field('Invalid entry alert').value).toBe('stop'); expect(field('Invalid entry alert').disabled).toBe(true);
  reject.click(); expect(field('Invalid entry alert').value).toBe('warning'); expect(field('Invalid entry alert').disabled).toBe(false);
});
it.each([{ strict: true }, { errorStyle: 'stop', showErrorMessage: true }, { strict: true, errorStyle: 'stop', showErrorMessage: false }])('preserves strict settings and visibility on an untouched save: %j', rule => {
  const { wb, panel, field, tab, save } = setup(rule); panel.querySelector('.names-main').click(); tab('error').click();
  const before = wb.toJSON(), version = wb.version; expect(field('Invalid entry alert').value).toBe('stop'); save(); expect(wb.toJSON()).toEqual(before); expect(wb.version).toBe(version);
});
