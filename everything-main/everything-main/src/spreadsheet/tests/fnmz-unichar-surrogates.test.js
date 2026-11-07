import { describe, it, expect } from 'vitest';
import { calc } from './helpers/calc.js';

// UNICHAR as documented: a partial surrogate (the numbers 55296 to 57343 are no
// character on their own) gives the #N/A error; zero gives #VALUE!.
describe('UNICHAR of a surrogate number', () => {
  it('is #N/A rather than a lone half of a character', () => {
    expect(calc('UNICHAR(55296)')).toEqual({ error: '#N/A' });
    expect(calc('UNICHAR(56320)')).toEqual({ error: '#N/A' });
    expect(calc('UNICHAR(57343)')).toEqual({ error: '#N/A' });
    expect(calc('UNICHAR(55295)')).toBe(String.fromCodePoint(0xd7ff));
    expect(calc('UNICHAR(57344)')).toBe(String.fromCodePoint(0xe000));
    expect(calc('UNICODE(UNICHAR(128512))')).toBe(128512);
    expect(calc('UNICHAR(0)')).toEqual({ error: '#VALUE!' });
  });
});
