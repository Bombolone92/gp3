import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { evaluateParts } from '../src/core/formula/print.js';

// The Evaluate formula dialog evaluates every part of a formula on its own; inside a LET the
// parts read the names bound before them, as the evaluator does, rather than #NAME?.
describe('evaluateParts inside LET', () => {
  const parts = (formula, cells = {}) => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    for (const [a1, text] of Object.entries(cells)) wb.setInput(id, Number(a1.slice(1)) - 1, a1.charCodeAt(0) - 65, text);
    wb.setInput(id, 9, 9, `=${formula}`);
    const out = evaluateParts(formula, wb.contextFor(id, 9, 9));
    expect(out.error).toBeNull();
    return Object.fromEntries(out.parts.map((p) => [p.text, p.value]));
  };

  it('shows each binding and the result with the earlier names bound', () => {
    const p = parts('LET(x,2,y,x*3,y+1)');
    expect(p['X*3']).toBe(6);
    expect(p['Y+1']).toBe(7);
    expect(p['LET(X,2,Y,X*3,Y+1)']).toBe(7);
    // A name used inside a value or the result is a part with the bound value.
    expect(p.X).toBe(2);
    expect(p.Y).toBe(6);
  });

  it('binds a reference with its address and a LET-bound lambda by name', () => {
    const p = parts('LET(r,A1:A3,total,SUM(r),total*2)', { A1: '1', A2: '2', A3: '3' });
    expect(p['SUM(R)']).toBe(6);
    expect(p['TOTAL*2']).toBe(12);
    const q = parts('LET(f,LAMBDA(n,n+1),f(4)+f(5))');
    expect(q['F(4)']).toBe(5);
    expect(q['F(4)+F(5)']).toBe(11);
  });

  it('keeps an outer LET name visible inside a nested LET, and a shadowing name local to it', () => {
    const p = parts('LET(a,1,LET(b,a+1,a+b)+a)');
    expect(p['A+1']).toBe(2);
    expect(p['A+B']).toBe(3);
    expect(p['LET(B,A+1,A+B)+A']).toBe(4);
  });
});
