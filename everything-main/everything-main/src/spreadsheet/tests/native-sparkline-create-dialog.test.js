// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { openSparklineCreateDialog } from '../src/ui/sparklinecreatedialog.js';
import { closeAllModals } from '../src/ui/modal.js';
beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('matchMedia', () => ({ matches: true })); document.body.innerHTML = '<div id="app"></div>'; });
afterEach(() => { closeAllModals(); vi.runAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); document.body.replaceChildren(); });
const setup = () => {
  const wb = new Workbook(), id = wb.activeSheetId, focus = vi.fn();
  const modal = openSparklineCreateDialog({ wb, sheetId: () => id, range: () => ({ r1: 0, r2: 1, c1: 4, c2: 4 }), grid: { focus } });
  const input = label => modal.panel.querySelector(`[aria-label="${label}"]`);
  const submit = () => modal.panel.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  return { wb, id, modal, input, submit, focus };
};
it('focuses data, prefills the selected destination and cancels without history', () => {
  const { wb, input } = setup(), before = wb.toJSON();
  expect(document.activeElement).toBe(input('Data range')); expect(input('Destination range').value).toBe('E1:E2');
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(wb.toJSON()).toEqual(before); expect(wb.canUndo()).toBe(false);
});
it('creates a native group and restores grid focus', () => {
  const { wb, id, input, submit, focus } = setup(); input('Data range').value = 'A1:C2'; input('Chart type').value = 'column'; submit();
  expect(wb.sheet(id).sparklineGroups[0]).toMatchObject({ type: 'column', sparklines: [{ ref: 'E1', formula: 'A1:C1' }, { ref: 'E2', formula: 'A2:C2' }] });
  expect(wb.undoLabels()).toHaveLength(1); expect(focus).toHaveBeenCalled();
});
it('links validation to the rejected input and keeps the dialog open', () => {
  const { wb, input, submit } = setup(); input('Data range').value = 'A1:C3'; submit();
  expect(input('Data range').getAttribute('aria-invalid')).toBe('true'); expect(document.activeElement).toBe(input('Data range')); expect(wb.canUndo()).toBe(false);
  input('Data range').value = 'A1:C2'; input('Destination range').value = 'E1:F2'; submit();
  expect(input('Destination range').getAttribute('aria-invalid')).toBe('true'); expect(wb.canUndo()).toBe(false);
});
