import { describe, it, expect } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseCellRef } from '../src/core/cell.js';

function book(cells = {}) {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  const at = (a1) => parseCellRef(a1);
  const api = {
    wb, id,
    set: (a1, text) => { const { r, c } = at(a1); wb.setInput(id, r, c, text); },
    val: (a1) => { const { r, c } = at(a1); return wb.getValue(id, r, c); },
  };
  for (const [a1, text] of Object.entries(cells)) api.set(a1, text);
  return api;
}

describe('spills that read other spills through covered cells', () => {
  it('settles a chain of spills in one calculation whichever order the anchors are read', () => {
    const b = book({ C1: '=SEQUENCE(2)', B1: '=SEQUENCE(2)+C2', A1: '=SEQUENCE(2)+B2' });
    // C = 1,2 → B = 3,4 → A = 5,6
    expect([b.val('A1'), b.val('A2')]).toEqual([5, 6]);
    expect([b.val('B1'), b.val('B2')]).toEqual([3, 4]);
    const first = book({ A1: '=SEQUENCE(2)+B2', B1: '=SEQUENCE(2)+C2', C1: '=SEQUENCE(2)' });
    expect(first.val('A2')).toBe(6);
    expect(first.val('A1')).toBe(5);
  });

  it('follows an edit to the far end of the chain', () => {
    const b = book({ C1: '=SEQUENCE(2)', B1: '=SEQUENCE(2)+C2', A1: '=SEQUENCE(2)+B2' });
    expect(b.val('A2')).toBe(6);
    b.set('C1', '=SEQUENCE(2)*10');
    expect([b.val('A1'), b.val('A2')]).toEqual([23, 24]);
  });

  it('reports a cycle that closes through a covered cell', () => {
    const b = book({ A1: '=SEQUENCE(3)+B1', B1: '=A3' });
    expect(b.val('B1')).toEqual({ error: '#CYCLE!' });
    expect(b.val('A1')).toEqual({ error: '#CYCLE!' });
  });
});
