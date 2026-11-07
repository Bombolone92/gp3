import { describe, it, expect } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseCellRef, parseRange } from '../src/core/cell.js';

function book(cells) {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  for (const [a1, text] of Object.entries(cells)) { const { r, c } = parseCellRef(a1); wb.setInput(id, r, c, String(text)); }
  return { wb, id };
}

// SUBTOTAL over a union (A1:A3,C1:C2) reads every area the way it reads a plain range:
// cells holding another SUBTOTAL are left out, and so are rows a filter hides.
describe('SUBTOTAL over a union reference', () => {
  const CELLS = { A1: 1, A2: 2, A3: '=SUBTOTAL(9,A1:A2)', C1: 5, C2: 6, B1: 'keep', B2: 'drop', E1: '=SUBTOTAL(9,(A1:A3,C1:C2))', E2: '=SUBTOTAL(9,A1:A3,C1:C2)', E3: '=SUBTOTAL(3,(A1:A3,C1:C2))', E4: '=SUBTOTAL(109,(A1:A3,C1:C2))' };

  it('leaves out nested subtotals in every area', () => {
    const { wb, id } = book(CELLS);
    expect(wb.getValue(id, 0, 4)).toBe(14);
    expect(wb.getValue(id, 1, 4)).toBe(14);
    expect(wb.getValue(id, 2, 4)).toBe(4);
  });

  it('skips filtered rows in every area', () => {
    const { wb, id } = book(CELLS);
    wb.setFilterRange(id, parseRange('B1:B2'));
    wb.setFilterCriteria(id, 1, { values: ['keep'] });
    expect([...wb.sheet(id).filterHidden]).toEqual([1]);
    expect(wb.getValue(id, 0, 4)).toBe(6);
    expect(wb.getValue(id, 1, 4)).toBe(6);
    expect(wb.getValue(id, 2, 4)).toBe(2);
  });

  it('skips rows hidden by hand for the 10x codes only', () => {
    const { wb, id } = book(CELLS);
    wb.setHidden(id, 'row', [1], true);
    expect(wb.getValue(id, 3, 4)).toBe(6);
    expect(wb.getValue(id, 0, 4)).toBe(14);
  });
});
