import { expect, it, vi } from 'vitest';
import { nestedRepeat, subjectLimit } from '../src/core/formula/regex-safety.js';
import { calc } from './helpers/calc.js';

it('reuses pattern analysis across repeated guard checks without repeating character sampling', () => {
  const pattern = '^[cache_Ä09]+$', spy = vi.spyOn(RegExp.prototype, 'test');
  try {
    expect(nestedRepeat(pattern)).toBe(false); expect(subjectLimit(pattern)).toBe(Infinity);
    const sampled = spy.mock.calls.length;
    expect(sampled).toBeGreaterThan(0);
    for (let i = 0; i < 100; i++) { expect(nestedRepeat(pattern)).toBe(false); expect(subjectLimit(pattern)).toBe(Infinity); }
    expect(spy.mock.calls.length).toBe(sampled);
  } finally { spy.mockRestore(); }
});
it('retains safety decisions after enough distinct patterns to evict cached analyses', () => {
  expect(nestedRepeat('(a+)+!')).toBe(true); expect(subjectLimit('a*a*!')).toBe(1000);
  for (let i = 0; i < 200; i++) expect(nestedRepeat(`^cache${i}[a-z]+$`)).toBe(false);
  expect(nestedRepeat('(a+)+!')).toBe(true); expect(subjectLimit('a*a*!')).toBe(1000);
  expect(nestedRepeat('[')).toBe(false); expect(subjectLimit('[')).toBe(Infinity);
});
it('checks each subject against the cached pattern limit, including after a short input succeeds', () => {
  expect(calc('REGEXTEST("short","a*a*!")')).toBe(false);
  expect(calc('REGEXTEST(REPT("a",1200),"a*a*!")')).toEqual({ error: '#VALUE!' });
  expect(calc('REGEXTEST("a!","a*a*!")')).toBe(true);
  expect(calc('REGEXTEST("a!","(a+)+!")')).toEqual({ error: '#VALUE!' });
});
