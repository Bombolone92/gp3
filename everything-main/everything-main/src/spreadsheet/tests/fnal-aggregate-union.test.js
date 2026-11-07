import { describe, it, expect } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseCellRef, parseRange } from '../src/core/cell.js';

function book(cells) {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  for (const [a1, text] of Object.entries(cells)) { const { r, c } = parseCellRef(a1); wb.setInput(id, r, c, String(text)); }
  return { wb, id, at: (a1) => { const { r, c } = parseCellRef(a1); return wb.getValue(id, r, c); } };
}

// AGGREGATE over a union (A1:A3,C1:C2) reads every area the way it reads a plain range: with
// options 0-3 cells holding another SUBTOTAL or AGGREGATE are left out, and with the odd
// options so are hidden rows. A union carries no single address, so nothing was left out.
describe('AGGREGATE over a union reference', () => {
  const CELLS = {
    A1: 1, A2: 2, A3: '=SUBTOTAL(9,A1:A2)', C1: 5, C2: 6, B1: 'keep', B2: 'drop',
    E1: '=AGGREGATE(9,0,(A1:A3,C1:C2))', E2: '=AGGREGATE(9,0,A1:A3,C1:C2)', E3: '=AGGREGATE(3,0,(A1:A3,C1:C2))',
    E4: '=AGGREGATE(9,4,(A1:A3,C1:C2))', E5: '=AGGREGATE(9,1,(A1:A3,C1:C2))', E6: '=AGGREGATE(14,0,(A1:A3,C1:C2),1)',
  };

  it('leaves out nested subtotals in every area for options 0-3, and counts them for 4-7', () => {
    const { at } = book(CELLS);
    expect(at('E1')).toBe(14);
    expect(at('E2')).toBe(14);
    expect(at('E3')).toBe(4);
    expect(at('E4')).toBe(17);
    expect(at('E6')).toBe(6);
  });

  it('skips rows hidden by hand or by a filter in every area for the odd options only', () => {
    const hidden = book(CELLS);
    hidden.wb.setHidden(hidden.id, 'row', [1], true);
    expect(hidden.at('E5')).toBe(6);
    expect(hidden.at('E1')).toBe(14);
    const filtered = book(CELLS);
    filtered.wb.setFilterRange(filtered.id, parseRange('B1:B2'));
    filtered.wb.setFilterCriteria(filtered.id, 1, { values: ['keep'] });
    expect([...filtered.wb.sheet(filtered.id).filterHidden]).toEqual([1]);
    expect(filtered.at('E5')).toBe(6);
  });

  it('still skips errors in every area when asked', () => {
    const { at } = book({ ...CELLS, C2: '=1/0', E7: '=AGGREGATE(9,2,(A1:A3,C1:C2))' });
    expect(at('E7')).toBe(8);
    expect(at('E1')).toEqual({ error: '#DIV/0!' });
  });
});
