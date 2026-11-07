import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

// Each function's array counts against the cell's four-million-cell budget, but the arrays the
// operators and IF build did not, so a chain of operators over two long sequences built one
// four-million-cell array per operator and pinned the processor for seconds.
describe('arrays built by operators and IF', () => {
  const at = (formula) => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, formula);
    return wb.getValue(id, 0, 0);
  };

  it('are refused past the budget without being built', () => {
    const t0 = performance.now();
    expect(at('=SUM(SEQUENCE(2000)*SEQUENCE(1,2000)+0+0+0+0+0+0+0+0+0+0)')).toEqual({ error: '#NUM!' });
    expect(at('=SUM(IF(SEQUENCE(2000)>0,SEQUENCE(1,2000),0)+0+0+0+0+0+0+0+0+0)')).toEqual({ error: '#NUM!' });
    // A division over 2.25 million cells fits the budget; IFERROR's replacement array over it does not.
    expect(at('=SUM(IFERROR(SEQUENCE(1500)/(SEQUENCE(1,1500)-1),0))')).toEqual({ error: '#NUM!' });
    expect(performance.now() - t0).toBeLessThan(4000);
  });

  it('still serve ordinary array arithmetic and conditions', () => {
    expect(at('=SUM(SEQUENCE(1000)*SEQUENCE(1,1000))')).toBe(500500 * 500500);
    expect(at('=SUM(IF(SEQUENCE(100)>50,1,0))')).toBe(50);
    expect(at('=SUM(IFERROR(1/(SEQUENCE(5)-3),10))')).toBeCloseTo(-1 / 2 - 1 + 10 + 1 + 1 / 2, 12);
    expect(at('=SUM(IFERROR(SEQUENCE(3)/(SEQUENCE(1,3)-1),0))')).toBe(9);
    expect(at('=SUM(SEQUENCE(100000)+1)')).toBe(5000050000 + 100000);
  });
});
