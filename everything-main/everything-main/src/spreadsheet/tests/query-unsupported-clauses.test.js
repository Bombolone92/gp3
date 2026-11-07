import { describe, expect, it } from 'vitest';
import { runQuery } from '../src/core/formula/query.js';
import { calc } from './helpers/calc.js';

// A pivot clause, or a datetime, timeofday or timestamp literal, is part of the Sheets query
// language this app does not implement; it was reported as "Unexpected token", a syntax error at
// no position, where format and options already said they were not supported. The generic
// message now names the token as well.

const data = [['Name', 'Qty', 'When'], ['a', 1, 45000], ['b', 2, 45001]];
const message = (query) => runQuery(data, query, { headers: 1 }).message;

describe('QUERY on clauses it does not implement', () => {
  it('says a pivot clause is not supported', () => {
    expect(message('select A, count(B) group by A pivot C')).toBe('pivot clauses are not supported');
    expect(message('select A pivot C')).toBe('pivot clauses are not supported');
    expect(message('select A where B > 1 pivot C order by A')).toBe('pivot clauses are not supported');
  });

  it.each(['datetime', 'timeofday', 'timestamp'])('says a %s literal is not supported', (kw) => {
    expect(message(`select A where C = ${kw} '2026-01-05 10:00:00'`)).toBe(`${kw} literals are not supported`);
    expect(message(`select ${kw} '2026-01-05 10:00:00'`)).toBe(`${kw} literals are not supported`);
  });

  it('still says format and options clauses are not supported', () => {
    expect(message("select A format A 'yyyy-mm-dd'")).toBe('format and options clauses are not supported');
    expect(message('select A options no_values')).toBe('format and options clauses are not supported');
  });

  it('names the token a query trips over', () => {
    expect(message('select A B')).toBe('Unexpected "B"');
    expect(message('select A where B > 1 1')).toBe('Unexpected "1"');
    expect(message("select A 'x'")).toBe(`Unexpected "'x'"`);
    expect(message('select A where B > desc')).toBe('Unexpected "desc"');
    expect(message('select A, )')).toBe('Unexpected ")"');
    expect(message('select `Qty` `Qty`')).toBe('Unexpected "`Qty`"');
  });

  it('answers #VALUE! from the QUERY function for such a query', () => {
    expect(calc('QUERY(A1:C3,"select A, count(B) group by A pivot C")', { A1: 'Name', B1: 'Qty', C1: 'When', A2: 'a', B2: '1', C2: '5', A3: 'b', B3: '2', C3: '6' })).toEqual({ error: '#VALUE!' });
    expect(calc('QUERY(A1:C3,"select A where B > 1")', { A1: 'Name', B1: 'Qty', C1: 'When', A2: 'a', B2: '1', C2: '5', A3: 'b', B3: '2', C3: '6' })).toBe('Name');
  });
});
