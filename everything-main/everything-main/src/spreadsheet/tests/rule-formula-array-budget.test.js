import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

// Conditional-format and validation formulas are evaluated outside a cell's own calculation, so a
// rule whose arrays exhaust the per-formula budget must not leave the next rule to fail with it.
it('gives each rule formula a fresh array budget', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '5');
  const range = { r1: 0, c1: 0, r2: 0, c2: 0 };
  const heavy = wb.evalRuleFormula(id, '=SUM(MAKEARRAY(40,40,LAMBDA(r,c,SUM(SEQUENCE(1000,100)))))>0', range, 0, 0);
  expect(heavy).toEqual({ error: '#NUM!' });
  expect(wb.evalRuleFormula(id, '=SUM(SEQUENCE(1000))>0', range, 0, 0)).toBe(true);
  expect(wb.evalRuleFormula(id, '=A1>1', range, 0, 0)).toBe(true);
});
