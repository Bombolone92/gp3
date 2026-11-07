import { expect, it } from 'vitest';
import { calc } from './helpers/calc.js';

// The BIT functions take non-negative integers below 2^48 and an integer
// shift; BITAND already refused 1.5 while BITLSHIFT silently truncated it.
it('refuses a fractional number or shift in every BIT function', () => {
  expect(calc('BITLSHIFT(1.5,1)')).toEqual({ error: '#NUM!' });
  expect(calc('BITRSHIFT(3.5,1)')).toEqual({ error: '#NUM!' });
  expect(calc('BITLSHIFT(4,1.5)')).toEqual({ error: '#NUM!' });
  expect(calc('BITRSHIFT(4,0.5)')).toEqual({ error: '#NUM!' });
  expect(calc('BITAND(1.5,1)')).toEqual({ error: '#NUM!' });
  expect(calc('BITOR(1,2.5)')).toEqual({ error: '#NUM!' });
  expect(calc('BITXOR(0.5,1)')).toEqual({ error: '#NUM!' });
});

it('keeps the integer cases and the other bounds', () => {
  expect(calc('BITLSHIFT(4,2)')).toBe(16);
  expect(calc('BITRSHIFT(13,2)')).toBe(3);
  expect(calc('BITLSHIFT(4,-1)')).toBe(2);
  expect(calc('BITRSHIFT(4,-1)')).toBe(8);
  expect(calc('BITLSHIFT(-1,1)')).toEqual({ error: '#NUM!' });
  expect(calc('BITLSHIFT(1,54)')).toEqual({ error: '#NUM!' });
  expect(calc('BITLSHIFT(2^47,1)')).toEqual({ error: '#NUM!' });
  expect(calc('BITLSHIFT("4",1)')).toBe(8);
});
