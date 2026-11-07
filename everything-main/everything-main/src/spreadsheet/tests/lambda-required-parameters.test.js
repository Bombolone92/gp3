import { describe, expect, it } from 'vitest';
import { calc } from './helpers/calc.js';

// Calling a LAMBDA with fewer arguments than it has required parameters is #VALUE!; only a
// parameter declared optional with [brackets] may be left out altogether.
const E = (code) => ({ error: code });

describe('LAMBDA required parameters', () => {
  it('reject a call that leaves a required parameter without a slot', () => {
    expect(calc('LAMBDA(x,x)()')).toEqual(E('#VALUE!'));
    expect(calc('LAMBDA(x,y,x+y)(1)')).toEqual(E('#VALUE!'));
    expect(calc('LET(f,LAMBDA(a,b,c,a),f(1,2))')).toEqual(E('#VALUE!'));
    expect(calc('LET(f,LAMBDA(a,b,c,a),f())')).toEqual(E('#VALUE!'));
  });

  it('still allow an optional parameter to be left out, and an empty slot to stand for a required one', () => {
    expect(calc('LAMBDA(x,[y],x+IF(ISOMITTED(y),10,y))(1)')).toBe(11);
    expect(calc('LAMBDA(x,[y],x+IF(ISOMITTED(y),10,y))(1,2)')).toBe(3);
    expect(calc('LAMBDA(x,y,x+y)(1,)')).toBe(1);
    expect(calc('LAMBDA(x,y,ISOMITTED(y))(1,)')).toBe(true);
    expect(calc('LET(f,LAMBDA(a,b,c,ISOMITTED(a)+2*ISOMITTED(b)+4*ISOMITTED(c)),f(,,))')).toBe(7);
  });

  it('still reject too many arguments and keep higher-order calls working', () => {
    expect(calc('LAMBDA(x,x)(1,2)')).toEqual(E('#VALUE!'));
    expect(calc('SUM(MAP({1,2,3},LAMBDA(v,v*2)))')).toBe(12);
    expect(calc('REDUCE(0,{1,2,3},LAMBDA(a,b,a+b))')).toBe(6);
    expect(calc('SUM(MAP({1,2,3},LAMBDA(v,w,v)))')).toEqual(E('#VALUE!'));
  });
});
