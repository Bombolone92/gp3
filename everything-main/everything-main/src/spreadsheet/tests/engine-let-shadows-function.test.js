import { describe, expect, it } from 'vitest';
import { calc } from './helpers/calc.js';

// A LET name may share a built-in's spelling; the call form still reaches the built-in,
// while the bare name is the local and a local LAMBDA is called by name.
describe('a LET name spelled like a function', () => {
  it('leaves the call form to the built-in', () => {
    expect(calc('LET(PI,5,PI()+PI)')).toBeCloseTo(Math.PI + 5, 12);
    expect(calc('LET(SUM,10,SUM(1,2)*SUM)')).toBe(30);
    expect(calc('LAMBDA(MAX,MAX(MAX,1))(4)')).toBe(4);
  });

  it('calls a local LAMBDA by name and refuses to call a local value', () => {
    expect(calc('LET(SUM,LAMBDA(x,x*2),SUM(3))')).toBe(6);
    expect(calc('LET(f,LAMBDA(a,a+1),f(1))')).toBe(2);
    expect(calc('LET(f,5,f(2))')).toEqual({ error: '#VALUE!' });
  });
});
