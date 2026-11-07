// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { openAiDialog } from '../src/ui/aidialog.js';
import { closeAllModals } from '../src/ui/modal.js';
import { toast } from '../src/ui/toast.js';
import * as P from '../src/lib/puter.js';
vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));
beforeEach(() => { vi.stubGlobal('matchMedia', () => ({ matches: true })); vi.spyOn(P, 'canAI').mockReturnValue(true); document.body.innerHTML = '<div id="app"></div>'; toast.mockClear(); });
afterEach(() => { closeAllModals(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const insert = async (wb, id, r, mode = 'write') => {
  vi.spyOn(P, 'aiChat').mockResolvedValue('=1+1');
  const { panel } = openAiDialog({ wb, sheetId: () => id, active: () => ({ r, c: 0 }), range: () => ({ r1: r, c1: 0, r2: r, c2: 0 }), grid: { focus() {} } }, { mode });
  panel.querySelector('textarea').value = 'two';
  panel.querySelector('form').requestSubmit();
  await new Promise((res) => setTimeout(res, 0));
  [...panel.querySelectorAll('button')].find((b) => /Insert into|Write into/.test(b.textContent) && !b.hidden).click();
  return panel;
};
// Inserted into part of an array formula, the result was refused without a word and the dialog closed saying it
// had been written: the formula was lost, and the workbook's own notice covered by the false one.
it('says in the dialog that a cell inside an array formula cannot take the result, and keeps it open', async () => {
  const wb = new Workbook(); const id = wb.activeSheetId;
  wb.setArrayFormula(id, { r1: 0, c1: 0, r2: 2, c2: 0 }, '=ROW(A1:A3)');
  const panel = await insert(wb, id, 1);
  expect(toast).not.toHaveBeenCalled();
  expect(panel.querySelector('[role="alert"]').textContent).toBe('A2 is part of the array formula in A1:A3, which can only be changed as a whole. Select another cell and ask again.');
});
it('still writes into a plain cell, and into an array of one cell, which an entry replaces', async () => {
  const wb = new Workbook(); const id = wb.activeSheetId;
  wb.setArrayFormula(id, { r1: 4, c1: 0, r2: 4, c2: 0 }, '=ROW(A1)');
  await insert(wb, id, 3);
  expect(wb.getCell(id, 3, 0).f).toBe('1+1');
  await insert(wb, id, 4);
  expect(wb.getCell(id, 4, 0).f).toBe('1+1');
  expect(toast.mock.calls.map((c) => c[0])).toEqual(['Formula written into A4', 'Formula written into A5']);
});
