import { describe, expect, it } from 'vitest';
import { runQuery } from '../src/core/formula/query.js';

// `matches` wraps the pattern in ^(?:…)$ so it must match the whole cell; a pattern with an
// unbalanced parenthesis, zzz)|(a, escaped the wrapper and matched a substring instead.
describe('QUERY matches', () => {
  const data = [['a'], ['abc'], ['zzz']];
  const run = (query) => runQuery(data, query, { headers: 0 });

  it('rejects a pattern that does not compile on its own', () => {
    expect(run("select A where A matches 'zzz)|(a'")).toMatchObject({ error: '#VALUE!' });
    expect(run("select A where A matches 'a('")).toMatchObject({ error: '#VALUE!' });
  });

  it('still matches the whole cell with balanced alternatives', () => {
    expect(run("select A where A matches 'zzz|a'").values).toEqual([['a'], ['zzz']]);
    expect(run("select A where A matches '(zzz)|(a)'").values).toEqual([['a'], ['zzz']]);
    expect(run("select A where A matches 'a.*'").values).toEqual([['a'], ['abc']]);
  });
});
