// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { buildPrintRoot } from '../src/ui/print.js';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';

// "Repeat frozen rows on every page" was turned off whenever a selection was printed, so a print area A1:D40 with
// rows 1-2 frozen had no <thead> and pages 2 and on printed without the header rows. Print titles repeat
// inside a print area too.
function frozenBook() {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  for (let r = 0; r < 40; r++) for (let c = 0; c < 4; c++) wb.setInput(id, r, c, r < 2 ? `Head ${r + 1}-${c + 1}` : `${r + 1}-${c + 1}`);
  wb.mergeCells(id, parseRange('A1:D1'));
  wb.setFrozen(id, 2, 0);
  return { wb, id };
}
const rows = (root, part) => [...root.querySelectorAll(`${part} tr`)].map((tr) => tr.firstElementChild?.textContent);

describe('printing a selection that holds the frozen rows', () => {
  it('repeats them on every page, as printing the sheet does', () => {
    const { wb, id } = frozenBook();
    const selection = buildPrintRoot(wb, id, 'Budget', { area: 'selection', range: parseRange('A1:D12'), repeatFrozen: true, marginBoxes: true });
    expect(rows(selection, 'thead')).toEqual(['Head 1-1', 'Head 2-1']);
    expect(rows(selection, 'tbody')).toHaveLength(10);
    expect(rows(selection, 'tbody')[0]).toBe('3-1');
    // A merge inside the head keeps its span there.
    expect(selection.querySelector('thead td').colSpan).toBe(4);
    const sheet = buildPrintRoot(wb, id, 'Budget', { area: 'sheet', repeatFrozen: true, marginBoxes: true });
    expect(rows(sheet, 'thead')).toEqual(rows(selection, 'thead'));
    // With row numbers and column letters, the letters row heads the repeated rows as it does for the sheet.
    const lettered = buildPrintRoot(wb, id, 'Budget', { area: 'selection', range: parseRange('A1:D12'), repeatFrozen: true, headers: true, marginBoxes: true });
    expect(lettered.querySelectorAll('thead tr')).toHaveLength(3);
  });

  it('prints a selection below the frozen rows, or one printed with the option off, without a head', () => {
    const { wb, id } = frozenBook();
    const below = buildPrintRoot(wb, id, 'Budget', { area: 'selection', range: parseRange('A5:D12'), repeatFrozen: true, marginBoxes: true });
    expect(below.querySelector('thead')).toBeNull();
    expect(rows(below, 'tbody')).toHaveLength(8);
    expect(rows(below, 'tbody')[0]).toBe('5-1');
    const off = buildPrintRoot(wb, id, 'Budget', { area: 'selection', range: parseRange('A1:D12'), repeatFrozen: false, marginBoxes: true });
    expect(off.querySelector('thead')).toBeNull();
    expect(rows(off, 'tbody')).toHaveLength(12);
  });

  it('puts a selection starting inside the frozen rows under the frozen rows it holds', () => {
    const { wb, id } = frozenBook();
    const second = buildPrintRoot(wb, id, 'Budget', { area: 'selection', range: parseRange('A2:D12'), repeatFrozen: true, marginBoxes: true });
    expect(rows(second, 'thead')).toEqual(['Head 2-1']);
    expect(rows(second, 'tbody')).toHaveLength(10);
  });
});
