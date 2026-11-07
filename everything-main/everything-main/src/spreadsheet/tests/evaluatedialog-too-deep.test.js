// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { openEvaluateDialog } from '../src/ui/evaluatedialog.js';
import { closeAllModals } from '../src/ui/modal.js';
import { evaluateParts } from '../src/core/formula/print.js';

vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));
vi.mock('../src/core/formula/print.js', async (importOriginal) => ({ ...(await importOriginal()), evaluateParts: vi.fn() }));

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  document.body.innerHTML = '<div id="app"></div>';
});
afterEach(() => { closeAllModals(); vi.unstubAllGlobals(); });

function open(wb) {
  const id = wb.activeSheetId;
  return openEvaluateDialog({ wb, sheetId: () => id, active: () => ({ r: 0, c: 0 }), grid: { focus() {} } });
}

// A formula the walk cannot take apart threw out of the dialog; it now says so, as it does for one it cannot parse.
it('says a formula nests too deeply to follow instead of throwing', () => {
  const wb = new Workbook();
  wb.setInput(wb.activeSheetId, 0, 0, '=1+1');
  evaluateParts.mockImplementation(() => { throw new RangeError('Maximum call stack size exceeded'); });
  expect(() => open(wb)).not.toThrow();
  expect(document.querySelector('.field-error').textContent).toBe('Cannot read this formula: it nests too deeply to follow');
  expect(document.querySelectorAll('.eval-table tbody tr')).toHaveLength(0);
});

it('still lists the parts of a formula it can follow', () => {
  const wb = new Workbook();
  wb.setInput(wb.activeSheetId, 0, 0, '=1+1');
  evaluateParts.mockImplementation(() => ({ error: null, parts: [{ depth: 0, text: '1+1', value: 2 }] }));
  open(wb);
  expect(document.querySelector('.field-error')).toBeNull();
  expect(document.querySelectorAll('.eval-table tbody tr')).toHaveLength(1);
});
