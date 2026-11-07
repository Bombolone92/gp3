import { describe, it, expect } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

const calc = (formula) => {
  const wb = new Workbook();
  wb.setInput(wb.activeSheetId, 0, 0, formula);
  return wb.getValue(wb.activeSheetId, 0, 0);
};

// With payments at the start of each period (type 1), the interest for period
// k is charged on the balance after k-1 payments and is itself paid a period
// early, so it is discounted by one period. Period 1 carries no interest.
describe('IPMT and PPMT with payments in advance', () => {
  it('computes an 8,000 loan at 10% over 3 periods', () => {
    expect(calc('=IPMT(0.1,1,3,8000,0,1)')).toBe(0);
    expect(calc('=IPMT(0.1,2,3,8000,0,1)')).toBeCloseTo(-507.55, 2);
    expect(calc('=IPMT(0.1,3,3,8000,0,1)')).toBeCloseTo(-265.86, 2);
  });

  it('splits every payment into principal and interest that add up to the loan', () => {
    const principal = [1, 2, 3].map((k) => calc(`=PPMT(0.1,${k},3,8000,0,1)`));
    expect(principal.reduce((a, b) => a + b, 0)).toBeCloseTo(-8000, 6);
    const endPrincipal = [1, 2, 3].map((k) => calc(`=PPMT(0.1,${k},3,8000,0,0)`));
    expect(endPrincipal.reduce((a, b) => a + b, 0)).toBeCloseTo(-8000, 6);
  });

  it('leaves payments at the end of the period as they were', () => {
    expect(calc('=IPMT(0.1,1,3,8000)')).toBeCloseTo(-800, 6);
    expect(calc('=IPMT(0.1,2,3,8000)')).toBeCloseTo(-558.31, 2);
    expect(calc('=IPMT(0.1,4,3,8000)')).toEqual({ error: '#NUM!' });
  });
});
