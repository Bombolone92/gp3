import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

// A bounded reference is read only a fixed distance past its data (1000 rows, 26 columns).
// In array arithmetic it still stands for every cell it names.
describe('array arithmetic over a bounded range read past its data', () => {
  const book = () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    for (const [r, t] of [[0, 'a'], [1, 'b'], [2, 'c']]) wb.setInput(id, r, 0, t);
    return { wb, id };
  };
  const at = (wb, id, f) => { wb.setInput(id, 50, 40, f); return wb.getValue(id, 50, 40); };

  it.each([
    ['=SUMPRODUCT(--(A1:A2000=""))', 1997],
    ['=SUM(IF(A1:A2000="",1,0))', 1997],
    ['=ROWS(A1:A2000*2)', 2000],
    ['=ROWS(-A5:A1500)', 1496],
    ['=COLUMNS(A1:AZ1*2)', 52],
    ['=SUM(IF(A1:AZ1="",1,0))', 51],
    ['=MAX(IF(A1:A2000="",ROW(A1:A2000)))', 2000],
    ['=SUMPRODUCT((A1:A2000="")*ROW(A1:A2000))', (2000 * 2001) / 2 - 6],
    ['=SUMPRODUCT((A1:A2000<>"")*1)', 3],
  ])('%s → %s, agreeing with COUNTBLANK and the reference shape', (formula, expected) => {
    const { wb, id } = book();
    expect(at(wb, id, formula)).toBe(expected);
  });

  it('spills the whole shape of the reference, a huge one included', { timeout: 60000 }, () => {
    const { wb, id } = book();
    wb.setInput(id, 0, 5, '=A1:A2000&"!"');
    expect(wb.getValue(id, 0, 5)).toBe('a!');
    expect(wb.getValue(id, 1999, 5)).toBe('!');
    expect(wb.getValue(id, 2000, 5)).toBeNull();
    // The rows past the data are one shared blank row, so a reference of 200,000 cells is padded in a moment.
    const t0 = performance.now();
    expect(at(wb, id, '=ROWS(A1:B100000*1)')).toBe(100000);
    expect(performance.now() - t0).toBeLessThan(2000);
  });
});
