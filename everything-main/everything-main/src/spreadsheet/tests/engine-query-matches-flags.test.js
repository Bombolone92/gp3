import { describe, expect, it } from 'vitest';
import { runQuery } from '../src/core/formula/query.js';
import { calc } from './helpers/calc.js';

// REGEXMATCH reads RE2's leading inline flags, (?i), (?s) and (?m); QUERY's `matches` refused them.
describe('QUERY matches with inline flags', () => {
  const data = [['Apple'], ['apple'], ['a\nb'], ['banana']];
  const rows = (query) => runQuery(data, query, { headers: 0 }).values;

  it('reads (?i) as case-insensitive and (?s) as dot-matches-newline', () => {
    expect(rows("select A where A matches '(?i)APPLE'")).toEqual([['Apple'], ['apple']]);
    expect(rows("select A where A matches 'APPLE'")).toEqual([[null]]);
    expect(rows("select A where A matches '(?s)a.b'")).toEqual([['a\nb']]);
    expect(rows("select A where A matches 'a.b'")).toEqual([[null]]);
    expect(rows("select A where A matches '(?is)A.B'")).toEqual([['a\nb']]);
    expect(rows("select A where A matches '(?i)(?s)A.B'")).toEqual([['a\nb']]);
  });

  it('still refuses a flag it cannot honour, and keeps the same pattern apart by its flags', () => {
    expect(runQuery(data, "select A where A matches '(?U)b'", { headers: 0 })).toMatchObject({ error: '#VALUE!' });
    expect(rows("select A where A matches 'apple'")).toEqual([['apple']]);
    expect(rows("select A where A matches '(?i)apple'")).toEqual([['Apple'], ['apple']]);
    expect(rows("select A where A matches 'apple'")).toEqual([['apple']]);
  });

  it('agrees with REGEXMATCH through a formula', () => {
    expect(calc('QUERY(A1:A2,"select A where A matches \'(?i)B.*\'")', { A1: 'Bee', A2: 'x' })).toBe('Bee');
  });
});
