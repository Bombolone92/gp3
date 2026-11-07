import { describe, expect, it } from 'vitest';
import { calc } from './helpers/calc.js';

// CODE gives the code point of the first character, as UNICODE does and as the rest of the text
// family counts characters, so CODE("😀") is 128512 and UNICHAR(CODE(x)) round-trips,
// instead of 55357, the first UTF-16 half of the emoji, which is no character at all.
describe('CODE of a character outside the basic plane', () => {
  it('is the code point, as UNICODE gives it', () => {
    expect(calc('CODE("😀")')).toBe(128512);
    expect(calc('CODE("😀")=UNICODE("😀")')).toBe(true);
    expect(calc('UNICHAR(CODE("😀"))')).toBe('😀');
    expect(calc('CODE("𝒳b")')).toBe(119987);
    expect(calc('CODE(UNICHAR(128512))')).toBe(128512);
  });

  it('keeps the basic plane and the empty text as they were', () => {
    expect(calc('CODE("A")')).toBe(65);
    expect(calc('CODE("abc")')).toBe(97);
    expect(calc('CODE("é")')).toBe(233);
    expect(calc('CODE("€")')).toBe(8364);
    expect(calc('CODE("")')).toEqual({ error: '#VALUE!' });
    expect(calc('CODE(CHAR(255.5))')).toBe(255);
  });
});
