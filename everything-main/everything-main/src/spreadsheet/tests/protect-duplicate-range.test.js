// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { openProtectedRanges } from '../src/ui/protect.js';
import { closeAllModals } from '../src/ui/modal.js';
import { toast } from '../src/ui/toast.js';

vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));
beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  document.body.innerHTML = '<div id="app"></div>';
});
afterEach(() => { closeAllModals(); vi.unstubAllGlobals(); vi.clearAllMocks(); document.body.replaceChildren(); });

function open(wb) {
  const id = wb.activeSheetId;
  const { panel } = openProtectedRanges({ wb, sheetId: () => id, range: () => ({ r1: 1, c1: 1, r2: 3, c2: 3 }) });
  const input = panel.querySelector('[aria-label="Range"]');
  const submit = (text) => { input.value = text; panel.querySelector('form').requestSubmit(); };
  return { id, panel, submit, error: panel.querySelector('.field-error') };
}

// Protecting the same cells twice stored two identical entries, each needing its own unprotect.
it('refuses to protect a range that is already protected, however it is written', () => {
  const wb = new Workbook();
  const { id, submit, error, panel } = open(wb);
  submit('B2:D9');
  expect(wb.sheet(id).protectedRanges).toHaveLength(1);
  toast.mockClear();
  submit('D9:B2');
  expect(wb.sheet(id).protectedRanges).toHaveLength(1);
  expect(error.hidden).toBe(false);
  expect(error.textContent).toBe('B2:D9 is already protected');
  expect(toast).not.toHaveBeenCalled();
  expect(wb.undoLabels().filter((l) => l === 'Protect range')).toHaveLength(1);
  // A different range is still fine.
  submit('F4');
  expect(wb.sheet(id).protectedRanges).toHaveLength(2);
  expect(error.hidden).toBe(true);
  expect(panel.querySelectorAll('.names-row')).toHaveLength(2);
});

it('refuses to edit an entry into a copy of another one, but lets it keep its own range', () => {
  const wb = new Workbook();
  const { id, submit, error, panel } = open(wb);
  submit('B2:D9');
  submit('F4');
  panel.querySelectorAll('.names-main')[1].click(); // edit F4
  panel.querySelector('[aria-label="Description"]').value = 'Totals';
  submit('B2:D9');
  expect(error.hidden).toBe(false);
  expect(wb.sheet(id).protectedRanges.map((p) => p.description)).toEqual(['', '']);
  submit('F4');
  expect(error.hidden).toBe(true);
  expect(wb.sheet(id).protectedRanges.map((p) => p.description)).toEqual(['', 'Totals']);
});

it('returns the existing entry from protectRange instead of adding a twin', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  const first = wb.protectRange(id, { r1: 1, c1: 1, r2: 8, c2: 3 }, 'one');
  const again = wb.protectRange(id, { r1: 8, c1: 3, r2: 1, c2: 1 }, 'two');
  expect(again).toBe(first);
  expect(wb.sheet(id).protectedRanges).toHaveLength(1);
  expect(wb.undoLabels()).toEqual(['Protect range']);
});
