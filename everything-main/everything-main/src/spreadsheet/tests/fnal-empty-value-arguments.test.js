import { describe, expect, it } from 'vitest';
import { calc } from './helpers/calc.js';

const E = (code) => ({ error: code });

// An argument left empty between commas is the value 0 when it is the one a
// choosing function returns, as IF and IFS already read it (the evaluator marks
// the thunk omitted for this): =IFERROR(NA(),) shows 0, not a blank.
describe('an empty value argument chosen by IFERROR, IFNA, CHOOSE or SWITCH', () => {
  it('is 0, as it is for IF and IFS', () => {
    expect(calc('IF(TRUE,)')).toBe(0);
    expect(calc('IFS(TRUE,)')).toBe(0);
    expect(calc('IFERROR(NA(),)')).toBe(0);
    expect(calc('IFERROR(1/0,)')).toBe(0);
    expect(calc('IFNA(NA(),)')).toBe(0);
    expect(calc('CHOOSE(1,)')).toBe(0);
    expect(calc('CHOOSE(2,"a",)')).toBe(0);
    expect(calc('SWITCH(1,1,)')).toBe(0);
    expect(calc('SWITCH(1,2,"x",)')).toBe(0);
    expect(calc('ISNUMBER(IFERROR(NA(),))')).toBe(true);
  });

  it('is not read when another argument is chosen', () => {
    expect(calc('IFERROR(5,)')).toBe(5);
    expect(calc('IFNA(1/0,)')).toEqual(E('#DIV/0!'));
    expect(calc('CHOOSE(1,"a",)')).toBe('a');
    expect(calc('SWITCH(1,1,"one",)')).toBe('one');
  });

  it('is 0 at each position CHOOSE picks it for an array of indices', () => {
    expect(calc('INDEX(CHOOSE({1,2},5,),1,2)')).toBe(0);
    expect(calc('INDEX(CHOOSE({1,2},5,),1,1)')).toBe(5);
  });
});
