// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { openProtectedRanges } from '../src/ui/protect.js';
import { closeAllModals } from '../src/ui/modal.js';

vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  document.body.innerHTML = '<div id="app"></div>';
});
afterEach(() => { closeAllModals(); vi.unstubAllGlobals(); });

function open(wb) {
  const id = wb.activeSheetId;
  const { panel } = openProtectedRanges({ wb, sheetId: () => id, range: () => ({ r1: 1, c1: 1, r2: 3, c2: 3 }) });
  const input = panel.querySelector('[aria-label="Range"]');
  const submit = (text) => { input.value = text; panel.querySelector('form').requestSubmit(); };
  return { id, panel, submit, error: () => panel.querySelector('.field-error') };
}

// The protected-ranges box used to accept any A1 text, including rows past
// the sheet's limit. Such a protection was dropped by the next structural undo
// or reload, so it looked in place and then vanished.
it('refuses a range beyond the sheet limits instead of storing a protection that will vanish', () => {
  const wb = new Workbook();
  const { id, submit, error } = open(wb);
  submit('A1:A2000000');
  expect(wb.sheet(id).protectedRanges).toEqual([]);
  expect(error().hidden).toBe(false);
  expect(error().textContent).toMatch(/range/i);
});

it('protects an ordinary range, a single cell and a named range on this sheet', () => {
  const wb = new Workbook();
  wb.defineName('Totals', 'Sheet1!$D$2:$D$9');
  const { id, submit } = open(wb);
  submit('B2:D9');
  submit('F4');
  submit('Totals');
  expect(wb.sheet(id).protectedRanges.map((p) => p.range)).toEqual([
    { r1: 1, c1: 1, r2: 8, c2: 3 },
    { r1: 3, c1: 5, r2: 3, c2: 5 },
    { r1: 1, c1: 3, r2: 8, c2: 3 },
  ]);
});

it('refuses a range on another sheet', () => {
  const wb = new Workbook();
  wb.addSheet('Data');
  wb.activeSheetId = wb.sheets[0].id;
  const { id, submit, error } = open(wb);
  submit('Data!A1:B2');
  expect(wb.sheet(id).protectedRanges).toEqual([]);
  expect(error().textContent).toMatch(/this sheet/i);
});
