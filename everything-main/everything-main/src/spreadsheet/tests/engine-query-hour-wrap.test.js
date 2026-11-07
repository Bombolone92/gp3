import { describe, expect, it } from 'vitest';
import { runQuery } from '../src/core/formula/query.js';

// The time of day was rounded to whole seconds without wrapping, so a moment just short of
// midnight read hour 24.
describe('QUERY hour, minute and second at midnight', () => {
  const row = (v, fn) => runQuery([[v]], `select ${fn}(A)`, { headers: 0 }).values[0][0];

  it('wrap a time rounding up to midnight to 0', () => {
    expect(row(0.9999999999, 'hour')).toBe(0);
    expect(row(0.9999999999, 'minute')).toBe(0);
    expect(row(0.9999999999, 'second')).toBe(0);
    expect(row(45000.9999999999, 'hour')).toBe(0);
  });

  it('still read an ordinary time', () => {
    expect(row(0.75, 'hour')).toBe(18);
    expect(row(0.5 + 90 / 86400, 'minute')).toBe(1);
    expect(row(0.5 + 90 / 86400, 'second')).toBe(30);
    expect(row(45000 + 23.5 / 24, 'hour')).toBe(23);
  });
});
