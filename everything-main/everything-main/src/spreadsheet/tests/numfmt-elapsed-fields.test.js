import { expect, it } from 'vitest';
import { formatWithCode, formatCodeError } from '../src/core/numfmt.js';
import { CALENDAR_END } from '../src/core/format.js';
import { calc } from './helpers/calc.js';

// Elapsed applies to the largest displayed time unit,
// even when a smaller field carries the brackets. Ordinary clock/date fields
// decompose the original serial once; subsequent totals use the evaluator's
// resulting numeric workspace. This is observable in both TEXT and cell styles.
it.each([
  ['[h] h', '51 51'], ['[s] s', '185145 185145'],
  ['[s] m', '45 65700'], ['[s] h', '45 1095'], ['[m] h', '25 1095'],
  ['m [m]', '1 65700'], ['d [h]', '2 1095'], ['s [h]', '45 1095'],
  ['d [s]', '2 3942000'], ['[s] mm:ss', '45 65700:45'], ['[s] hh:mm:ss', '45 1095:25:45'],
  ['[m] h:mm', '25 1095:25'], ['[h] ss', '51 45'], ['[m] ss', '3085 45'],
  ['[h].000 h', '51.125 3011'], ['[s].000 s', '185145.125 10843199'],
  ['[h] h.000', '51 51.125'], ['[s] s.000', '185145 185145.125'],
  ['[h] d h', '51 2 1095'], ['[s] d s', '185145 2 3942000'],
  ['[h] s h', '51 45 1095'], ['[h] m h', '51 25 1095'], ['[m] ss mm', '3085 45 01'],
])('evaluates elapsed and clock fields in %s', (code, expected) => {
  const value = 2 + 12345.125 / 86400;
  expect(formatWithCode(value, code)).toBe(expected);
  expect(calc(`TEXT(${value},"${code}")`)).toBe(expected);
});

it.each([
  [45000 + 43530.25 / 86400, '[s] h', '30 738'],
  [45000 + 43530.25 / 86400, '[s].000 s', '3888043530.250 21643155'],
  [45000 + 43530.25 / 86400, '[h] d h', '1080012 15 738'],
  [45356 + 43325 / 86400, '[s] m', '5 7920'],
  [0, '[h].000 h', '0.000 12'],
  [1.5, '[h] h', '36 36'],
])('retains field semantics across different magnitudes for %s in %s', (value, code, expected) => {
  expect(formatWithCode(value, code)).toBe(expected);
});

it.each(['h [h]', 'hh [h]', 's [s]', 'ss [ss]', 'h [s]', 'm:ss [m]', 'h m [m]'])('rejects an elapsed directive following its ordinary unit in %s', code => {
  expect(formatCodeError(code)).toMatch(/before/);
  expect(formatWithCode(1.5, code)).toBe('#####');
  expect(calc(`TEXT(1.5,"${code}")`)).toEqual({ error: '#VALUE!' });
});

it('limits clock/date remainders while retaining unbounded total-only durations', () => {
  for (const value of [CALENDAR_END, CALENDAR_END + 0.5, 4e6, 1e22]) {
    for (const code of ['[h]:mm', '[h]:mm:ss', '[m]:ss', '[s].0', '[h] d', '[m] m', '[s] h']) {
      expect(formatWithCode(value, code)).toBe('#####');
    }
  }
  expect(formatWithCode(CALENDAR_END, '[h] h')).toBe('71003184 71003184');
  expect(formatWithCode(CALENDAR_END, '[s] s')).toBe('255611462400 255611462400');
  expect(formatWithCode(1e22, '[h] "hours"')).toBe('240000000000000000000000 hours');
});

