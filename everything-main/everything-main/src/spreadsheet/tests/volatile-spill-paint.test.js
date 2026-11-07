import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

// Working out a sheet's spills emptied the whole value cache after a pass that landed one, so a
// RAND() already shown through its dependent was drawn again when the cell itself was painted.
describe('a volatile cell and its dependent painted while spills are worked out', () => {
  it('show the same value on every repaint', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, '=A2');
    wb.setInput(id, 1, 0, '=RAND()');
    wb.setInput(id, 0, 2, '=SEQUENCE(2)');
    for (let edit = 0; edit < 5; edit++) {
      wb.setInput(id, 5, 5, String(edit));
      const painted = [];
      for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) painted.push(wb.getDisplay(id, r, c));
      expect(painted[0]).toBe(painted[3]);
      expect(painted[2]).toBe('1');
      expect(painted[5]).toBe('2');
    }
  });

  it('show the same value when the spills of another sheet are worked out inside the dependent', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    const other = wb.addSheet('Other').id;
    wb.setInput(id, 0, 0, '=A2+Other!B1');
    wb.setInput(id, 1, 0, '=RAND()');
    wb.setInput(other, 0, 2, '=SEQUENCE(2)');
    for (let edit = 0; edit < 5; edit++) {
      wb.setInput(id, 5, 5, String(edit));
      const a1 = wb.getValue(id, 0, 0);
      expect(wb.getValue(id, 1, 0)).toBe(a1);
      expect(wb.getValue(other, 1, 2)).toBe(2);
    }
  });

  it('show the same value when a spill is settled after the calculation it met', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, '=B1+A2');
    wb.setInput(id, 1, 0, '=RAND()');
    wb.setInput(id, 0, 1, '=LAMBDA(2)()');
    wb.setInput(id, 0, 3, '=SEQUENCE(2,1,A1)');
    for (let edit = 0; edit < 5; edit++) {
      wb.setInput(id, 5, 5, String(edit));
      const a1 = wb.getValue(id, 0, 0);
      expect(a1).toBe(wb.getValue(id, 1, 0) + 2);
      expect(wb.getValue(id, 0, 3)).toBe(a1);
      expect(wb.getValue(id, 1, 3)).toBe(a1 + 1);
    }
  });
});
