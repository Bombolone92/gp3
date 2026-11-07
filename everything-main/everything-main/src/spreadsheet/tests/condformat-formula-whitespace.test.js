// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { openConditionalFormatting } from '../src/ui/condformat.js';
import { closeAllModals } from '../src/ui/modal.js';
vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal('matchMedia', () => ({ matches: true })); document.body.innerHTML = '<div id="app"></div>';
});
afterEach(() => {
  closeAllModals(); vi.runAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); document.body.replaceChildren();
});
it('applies a whitespace-prefixed formula accepted by the formatting dialog', () => {
  const wb = new Workbook(), id = wb.activeSheetId, range = { r1: 1, c1: 0, r2: 2, c2: 0 };
  wb.setInput(id, 1, 0, '3'); wb.setInput(id, 2, 0, '9');
  openConditionalFormatting({ wb, sheetId: () => id, range: () => range, grid: { focus: vi.fn() } });
  const condition = document.querySelector('[aria-label="Condition"]'); condition.value = 'formula'; condition.dispatchEvent(new Event('change'));
  document.querySelector('[aria-label="Value"]').value = '  =A2>5  ';
  document.querySelector('form').requestSubmit();
  expect(document.querySelector('.field-error').hidden).toBe(true); expect(wb.sheet(id).rules).toHaveLength(1);
  expect(wb.conditionalStyle(id, 2, 0, 9)).toMatchObject({ bg: '#fef3c7' });
  expect(wb.conditionalStyle(id, 1, 0, 3)).toBeNull();
  wb.undo(); expect(wb.sheet(id).rules).toHaveLength(0); wb.redo(); expect(wb.conditionalStyle(id, 2, 0, 9)).toMatchObject({ bg: '#fef3c7' });
});
