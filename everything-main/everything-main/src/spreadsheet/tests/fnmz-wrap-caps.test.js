import { describe, it, expect } from 'vitest';
import { calc } from './helpers/calc.js';

// WRAPROWS and WRAPCOLS pad their last line out to wrap_count cells, so a huge count
// asks for a huge array; like SEQUENCE and MAKEARRAY they stop at 100,000 cells with #NUM!.
const NUM = { error: '#NUM!' };

describe('WRAPROWS and WRAPCOLS size cap', () => {
  it('refuse a wrap count that pads the result past 100,000 cells', () => {
    expect(calc('WRAPROWS({1,2,3},1E6)')).toEqual(NUM);
    expect(calc('WRAPCOLS({1,2,3},3E7)')).toEqual(NUM);
    expect(calc('WRAPROWS({1,2,3},1E9)')).toEqual(NUM);
    expect(calc('WRAPCOLS({1,2,3},100001)')).toEqual(NUM);
  });

  it('still wrap within the cap', () => {
    expect(calc('COLUMNS(WRAPROWS({1,2,3},100000))')).toBe(100000);
    expect(calc('ROWS(WRAPCOLS({1,2,3},100000))')).toBe(100000);
    expect(calc('ROWS(WRAPROWS(SEQUENCE(7),3))')).toBe(3);
    expect(calc('INDEX(WRAPROWS(SEQUENCE(7),3,"-"),3,2)')).toBe('-');
    expect(calc('INDEX(WRAPCOLS(SEQUENCE(7),3),1,3)')).toBe(7);
  });
});
