import { expect, it } from 'vitest';
import { formatWithCode } from '../src/core/numfmt.js';
// A clock group spans calendar/literal fields.
// A minute field consumes the group; another hour starts a new group. A minute
// field immediately before seconds independently establishes its own meaning.
it.each([
  ['ss m', '46 25'], ['s m m', '46 25 3'], ['h d m', '3 15 25'],
  ['s d m', '46 15 25'], ['m d s m', '3 15 46 25'], ['m h s m', '3 3 46 25'],
  ['m m s m', '3 25 46 3'], ['m s d m', '25 46 15 3'], ['mmm s m', 'Mar 46 25'],
  ['h m h m', '3 25 3 25'], ['m s h m', '25 46 3 25'],
  ['h m s m s', '3 25 46 25 46'], ['h m m h m', '3 25 3 3 25'],
  ['h m .000 m', '3 25 .679 3'], ['m .000 d s m', '25 .679 15 45 3'],
  ['h m .000 h m', '3 25 .679 3 25'], ['h m .000 m.000', '3 25 .679 25.679'],
  ['hh:mm:ss mm/dd', '03:25:46 03/15'], ['yyyy-mm-dd hh:mm:ss', '2023-03-15 03:25:46'],
])('resolves the clock and calendar fields of %s', (code, expected) => {
  expect(formatWithCode(45000 + 12345.6789 / 86400, code)).toBe(expected);
});
