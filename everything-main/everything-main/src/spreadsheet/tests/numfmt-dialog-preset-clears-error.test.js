// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { openCustomFormatDialog } from '../src/ui/numfmtdialog.js';
import { closeAllModals } from '../src/ui/modal.js';

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  document.body.innerHTML = '<div id="app"></div>';
});
afterEach(() => { closeAllModals(); vi.runAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

// After Apply refused a code, picking an example preset showed its preview while the red message
// and the invalid mark stayed on the field, as if the preset were the refused code.
it('clears the refused-code message when an example preset is picked, as typing does', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '1234.5');
  const runs = [];
  const modal = openCustomFormatDialog({ wb, sheetId: () => id, active: () => ({ r: 0, c: 0 }), style: () => ({}), run: (cmd, arg) => runs.push([cmd, arg]), grid: { focus: vi.fn() } });
  const input = modal.panel.querySelector('input[aria-label="Format code"]');
  const error = modal.panel.querySelector('.field-error');
  const preview = modal.panel.querySelector('.numfmt-preview');
  input.value = '0.00"kg';
  input.dispatchEvent(new Event('input'));
  modal.panel.querySelector('form').requestSubmit();
  expect(runs).toEqual([]);
  expect(error.hidden).toBe(false);
  expect(input.getAttribute('aria-invalid')).toBe('true');
  const preset = modal.panel.querySelector('button.numfmt-preset');
  const code = preset.querySelector('.numfmt-code').textContent;
  preset.click();
  expect(input.value).toBe(code);
  expect(error.hidden).toBe(true);
  expect(input.hasAttribute('aria-invalid')).toBe(false);
  expect(preview.textContent).toContain('1234.5 → ');
  expect(document.activeElement).toBe(input);
  modal.panel.querySelector('form').requestSubmit();
  expect(runs).toEqual([['fmt', { fmt: 'custom', code, dec: null, dateStyle: null }]]);
});
