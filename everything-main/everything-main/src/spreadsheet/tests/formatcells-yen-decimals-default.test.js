// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { openFormatCellsDialog } from '../src/ui/formatcells.js';
import { closeAllModals } from '../src/ui/modal.js';

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  document.body.innerHTML = '<div id="app"></div>';
});
afterEach(() => { closeAllModals(); vi.runAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

function open(style) {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '1234.5');
  wb.applyStyle(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, style);
  const run = vi.fn();
  const { panel } = openFormatCellsDialog({ wb, sheetId: () => id, active: () => ({ r: 0, c: 0 }), style: () => wb.getCell(id, 0, 0).s, run, grid: { focus() {} } });
  return { panel, field: (label) => panel.querySelector(`[aria-label="${label}"]`), run };
}

// The Decimal places field offered two places for every currency, the yen included, although a yen cell
// without a count of its own shows none: Apply then stamped two decimals on a cell left as it was.
it('offers the decimals a currency shows: none for the yen, two for the dollar', () => {
  expect(open({ fmt: 'currency', cur: 'JPY' }).field('Decimal places').value).toBe('0');
  closeAllModals();
  expect(open({ fmt: 'currency', cur: 'USD' }).field('Decimal places').value).toBe('2');
  closeAllModals();
  expect(open({ fmt: 'currency', cur: 'JPY', dec: 2 }).field('Decimal places').value).toBe('2');
});
