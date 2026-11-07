import { describe, it, expect } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

// A workbook-wide name whose formula has no sheet in it (=A1*2) reads its
// cells relative to whichever sheet calls it. Structural edits used to treat
// those references as belonging to the edited sheet, so inserting a row on an
// unrelated sheet rewrote the name and broke every formula using it.
describe('unscoped names during structural edits', () => {
  const book = () => {
    const wb = new Workbook({ sheets: [{ name: 'S1' }, { name: 'S2' }] });
    const [s1, s2] = wb.sheets;
    wb.setInput(s1.id, 0, 0, '10');
    wb.setInput(s2.id, 0, 0, '100');
    wb.defineName('Dbl', 'A1*2');
    wb.setInput(s1.id, 1, 0, '=Dbl');
    wb.setInput(s2.id, 1, 0, '=Dbl');
    expect(wb.getValue(s1.id, 1, 0)).toBe(20);
    expect(wb.getValue(s2.id, 1, 0)).toBe(200);
    return { wb, s1, s2, name: () => wb.names.find((n) => n.name === 'Dbl').ref };
  };

  it('is left alone by row insertion, cell shifting and moves on other sheets', () => {
    const { wb, s1, s2, name } = book();
    wb.insertRows(s2.id, 0, 1);
    expect(name()).toBe('A1*2');
    expect(wb.getValue(s1.id, 1, 0)).toBe(20);
    wb.moveRange(s2.id, { r1: 1, c1: 0, r2: 1, c2: 0 }, 5, 5);
    expect(name()).toBe('A1*2');
    wb.insertCells(s2.id, { r1: 0, c1: 0, r2: 0, c2: 0 }, 'down');
    expect(name()).toBe('A1*2');
    expect(wb.getValue(s1.id, 1, 0)).toBe(20);
  });

  it('still follows edits when the name says which sheet it means', () => {
    const { wb, s1, name } = book();
    wb.defineName('Dbl', 'S1!A1*2');
    wb.insertRows(s1.id, 0, 1);
    // S1 also reads as a cell address, so the name is written quoted.
    expect(name()).toBe("'S1'!A2*2");
    expect(wb.getValue(s1.id, 2, 0)).toBe(20);
  });

  it('follows edits on a sheet-scoped name for its own sheet only', () => {
    const wb = new Workbook({ sheets: [{ name: 'S1' }, { name: 'S2' }] });
    const [s1, s2] = wb.sheets;
    wb.setInput(s1.id, 0, 0, '7');
    wb.defineName('Local', 'A1*2', 'S1');
    const ref = () => wb.names.find((n) => n.name === 'Local').ref;
    wb.insertRows(s2.id, 0, 1);
    expect(ref()).toBe('A1*2');
    wb.insertRows(s1.id, 0, 1);
    expect(ref()).toBe('A2*2');
  });
});
