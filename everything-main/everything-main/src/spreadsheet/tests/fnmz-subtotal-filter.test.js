import { describe, it, expect } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseCellRef, parseRange } from '../src/core/cell.js';
import { addSubtotals } from '../src/core/subtotal.js';

function book(cells) {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  for (const [a1, text] of Object.entries(cells)) { const { r, c } = parseCellRef(a1); wb.setInput(id, r, c, String(text)); }
  return { wb, id };
}

describe('SUBTOTAL over nested subtotals with rows filtered out', () => {
  it('still leaves out the nested SUBTOTAL cells when a row above them is hidden by a filter', () => {
    const { wb, id } = book({ A1: 1, A2: 2, A3: 3, A4: 4, A5: '=SUBTOTAL(9,A1:A4)', B1: 'keep', B2: 'drop', B3: 'keep', B4: 'keep', C1: '=SUBTOTAL(9,A1:A5)' });
    expect(wb.getValue(id, 0, 2)).toBe(10);
    wb.setFilterRange(id, parseRange('B1:B4'));
    wb.setFilterCriteria(id, 1, { values: ['keep'] });
    expect([...wb.sheet(id).filterHidden]).toEqual([1]);
    expect(wb.getValue(id, 4, 0)).toBe(8);
    expect(wb.getValue(id, 0, 2)).toBe(8);
  });

  it('keeps the grand total of Data > Subtotals equal to the visible detail rows under a filter', () => {
    const { wb, id } = book({
      A1: 'Region', B1: 'Item', C1: 'Sales',
      A2: 'West', B2: 'Pens', C2: '10',
      A3: 'East', B3: 'Ink', C3: '5',
      A4: 'West', B4: 'Paper', C4: '20',
      A5: 'East', B5: 'Clips', C5: '7',
      A6: 'North', B6: 'Tape', C6: '3',
    });
    const out = addSubtotals(wb, id, parseRange('A1:C6'), { groupCol: 0, code: 9, totalCols: [2], header: true });
    expect(out.r2).toBe(9);
    expect(wb.getCell(id, 9, 2).f).toBe('SUBTOTAL(9,C2:C9)');
    expect(wb.getValue(id, 9, 2)).toBe(45);
    // Filter the Item column so that Clips (row 3, above the East Total row) is hidden.
    wb.setFilterRange(id, parseRange('A1:C9'));
    wb.setFilterCriteria(id, 1, { values: ['Ink', 'Tape', 'Pens', 'Paper', ''] });
    expect([...wb.sheet(id).filterHidden]).toEqual([2]);
    expect(wb.getValue(id, 3, 2)).toBe(5); // East Total: Ink only
    expect(wb.getValue(id, 9, 2)).toBe(38); // 5 + 3 + 10 + 20, no subtotal row counted
  });

  it('still leaves out nested subtotals when a row above them is hidden by hand, for the 10x codes', () => {
    const { wb, id } = book({ A1: 1, A2: 2, A3: 3, A4: 4, A5: '=SUBTOTAL(109,A1:A4)', C1: '=SUBTOTAL(109,A1:A5)', C2: '=SUBTOTAL(9,A1:A5)' });
    wb.setHidden(id, 'row', [1], true);
    expect(wb.getValue(id, 4, 0)).toBe(8);
    expect(wb.getValue(id, 0, 2)).toBe(8);
    expect(wb.getValue(id, 1, 2)).toBe(10); // code 9 counts rows hidden by hand
  });
});
