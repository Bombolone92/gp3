import { describe, expect, it } from 'vitest';
import { Workbook, cellFromInput } from '../src/core/workbook.js';
import { parseInput } from '../src/core/format.js';

const A1 = { r1: 0, c1: 0, r2: 0, c2: 0 };

// "1/2" typed into a cell already formatted as a fraction was read as the date January 2 and
// stored as its serial, which the fraction code then showed as "46024    ". The documented
// way of keeping such an entry a fraction is to format the cell as a fraction first.
describe('a fraction typed into a fraction-formatted cell', () => {
  it('is the number it names, shown through the cell\'s own code', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.applyStyle(id, { r1: 0, c1: 0, r2: 5, c2: 0 }, { fmt: 'custom', code: '# ?/?' });
    const typed = ['1/2', '3/4', '-1/2', '2 3/4', '5/4', '0/7'];
    typed.forEach((t, r) => wb.setInput(id, r, 0, t));
    expect(typed.map((_, r) => wb.getCell(id, r, 0))).toEqual([0.5, 0.75, -0.5, 2.75, 1.25, 0]
      .map((v) => ({ v, f: null, s: { fmt: 'custom', code: '# ?/?' } })));
    // The blank "#" of a negative leaves its space, so it shows "- 1/2".
    expect(typed.map((_, r) => wb.getDisplay(id, r, 0).trim())).toEqual(['1/2', '3/4', '- 1/2', '2 3/4', '1 1/4', '0']);
    wb.setInput(id, 6, 0, '=A1+A2');
    expect(wb.getValue(id, 6, 0)).toBe(1.25);
  });

  it('reads a fixed-denominator or padded code as a fraction too, and a divide by zero as text', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.applyStyle(id, A1, { fmt: 'custom', code: '?/8' });
    wb.setInput(id, 0, 0, '3/8');
    expect(wb.getCell(id, 0, 0).v).toBe(0.375);
    wb.applyStyle(id, { r1: 1, c1: 0, r2: 1, c2: 0 }, { fmt: 'custom', code: '# ??/??' });
    wb.setInput(id, 1, 0, '7/16');
    expect(wb.getCell(id, 1, 0).v).toBe(0.4375);
    wb.setInput(id, 1, 0, '1/0');
    expect(typeof wb.getCell(id, 1, 0).v).toBe('string');
  });

  it('leaves entry into General, Number and date cells as it was: 1/2 is January 2', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    const serial = parseInput('1/2').v;
    expect(typeof serial).toBe('number');
    wb.setInput(id, 0, 0, '1/2');
    expect(wb.getCell(id, 0, 0)).toMatchObject({ v: serial, s: { fmt: 'date' } });
    wb.applyStyle(id, { r1: 1, c1: 0, r2: 1, c2: 0 }, { fmt: 'number', dec: 2 });
    wb.setInput(id, 1, 0, '1/2');
    expect(wb.getCell(id, 1, 0)).toEqual({ v: serial, f: null, s: { fmt: 'number', dec: 2 } });
    // A slash inside a quoted label, or a date code's slash, is not a fraction.
    expect(cellFromInput('1/2', { fmt: 'custom', code: '0.00 "km/h"' }).v).toBe(serial);
    expect(cellFromInput('1/2', { fmt: 'custom', code: 'm/d/yyyy' }).v).toBe(serial);
    // Text that is not a fraction still reads as before in a fraction cell.
    expect(cellFromInput('hello', { fmt: 'custom', code: '# ?/?' }).v).toBe('hello');
    expect(cellFromInput('=1/2', { fmt: 'custom', code: '# ?/?' }).f).toBe('1/2');
  });
});
