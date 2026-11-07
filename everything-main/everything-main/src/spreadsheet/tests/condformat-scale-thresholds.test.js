// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { openConditionalFormatting } from '../src/ui/condformat.js';
import { closeAllModals } from '../src/ui/modal.js';
vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));
beforeEach(() => { vi.stubGlobal('matchMedia', () => ({ matches: true })); document.body.innerHTML = '<div id="app"></div>'; });
afterEach(() => { closeAllModals(); vi.unstubAllGlobals(); document.body.replaceChildren(); });
const range = { r1: 1, c1: 1, r2: 3, c2: 1 };
function setup(rule = {}) {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setInput(id, 1, 1, '5');
  wb.addRule(id, { type: 'scale', range, from: '#ff0000', mid: '#ffff00', to: '#00ff00', scaleMin: '0', scaleMid: '2', scaleMax: '10', ...rule });
  const { panel } = openConditionalFormatting({ wb, sheetId: () => id, range: () => range, grid: { focus() {} } });
  panel.querySelector('.names-main').click();
  return { wb, id, panel, field: label => panel.querySelector(`[aria-label="${label}"]`), submit: () => panel.querySelector('form').requestSubmit() };
}
it('shows imported thresholds and keeps an unchanged save clean', () => {
  const { wb, field, submit } = setup();
  expect(field('Low threshold').value).toBe('=0');
  expect(field('Midpoint threshold').value).toBe('=2');
  expect(field('High threshold').value).toBe('=10');
  const before = wb.toJSON(), version = wb.version;
  submit(); expect(wb.toJSON()).toEqual(before); expect(wb.version).toBe(version);
});
it('edits numeric and formula thresholds and allows a return to automatic bounds', () => {
  const { wb, id, panel, field, submit } = setup();
  field('Low threshold').value = '-10'; field('Midpoint threshold').value = '=2+3'; field('High threshold').value = '20';
  submit(); expect(wb.activeSheet.rules[0]).toMatchObject({ scaleMin: '-10', scaleMid: '2+3', scaleMax: '20' });
  expect(wb.conditionalStyle(id, 1, 1, 5)).toEqual({ bg: '#ffff00' });
  panel.querySelector('.names-main').click();
  for (const label of ['Low threshold', 'Midpoint threshold', 'High threshold']) field(label).value = '';
  submit(); expect(wb.activeSheet.rules[0].scaleMin).toBeUndefined();
  expect(wb.activeSheet.rules[0].scaleMid).toBeUndefined(); expect(wb.activeSheet.rules[0].scaleMax).toBeUndefined();
  expect(wb.conditionalStyle(id, 1, 1, 5)).toEqual({ bg: '#00ff00' });
  wb.undo(); expect(wb.activeSheet.rules[0].scaleMin).toBe('-10');
});
it('keeps invalid threshold input focused and permits correction', () => {
  const { wb, panel, field, submit } = setup(), before = wb.toJSON();
  field('Low threshold').value = 'bad'; submit();
  expect(wb.toJSON()).toEqual(before); expect(document.activeElement).toBe(field('Low threshold'));
  expect(panel.querySelector('.field-error').textContent).toContain('Enter a number');
  field('Low threshold').value = '=SUM('; submit(); expect(wb.toJSON()).toEqual(before);
  expect(panel.querySelector('.field-error').textContent).toContain('cannot be read');
  field('Low threshold').value = '-1'; submit(); expect(wb.activeSheet.rules[0].scaleMin).toBe('-1');
});
it('keeps automatic scales unchanged when opened and saved', () => {
  const { wb, submit } = setup({ scaleMin: undefined, scaleMid: undefined, scaleMax: undefined });
  const before = wb.toJSON(), version = wb.version;
  submit(); expect(wb.toJSON()).toEqual(before); expect(wb.version).toBe(version);
});
