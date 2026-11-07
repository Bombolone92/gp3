import { expect, it } from 'vitest';
import { FUNCTIONS } from '../src/core/formula/functions.js';
import oracle from './fixtures/reference-lookup-text-modes.json';

it.each(oracle.cases)('preserves native legacy/wildcard versus modern text matching: $needle / $values', ({ needle, values, expected }) => {
  for (const grid of [[values], values.map(v => [v])]) {
    const range = { range: true, values: grid };
    for (let pass = 0; pass < 3; pass++) {
      expect(FUNCTIONS.MATCH.fn([needle, range, 0])).toEqual(expected[0]);
      expect(FUNCTIONS.XMATCH.fn([needle, range, 0])).toEqual(expected[1]);
      expect(FUNCTIONS.XMATCH.fn([needle, range, 2])).toEqual(expected[2]);
      expect(FUNCTIONS.XMATCH.fn([needle, range, 0, -1])).toEqual(expected[3]);
      expect(FUNCTIONS.XMATCH.fn([needle, range, 2, -1])).toEqual(expected[4]);
    }
  }
  expect(FUNCTIONS.SEARCH.fn([needle, values[0]])).toEqual(expected[5]);
});

it('shares native mode distinctions across vertical, horizontal and modern return lookups', () => {
  const table = { range: true, values: [['ss', 10], ['ß', 20], ['SS', 30]] };
  const keys = { range: true, values: table.values.map(row => [row[0]]) };
  const values = { range: true, values: [[10], [20], [30]] };
  const horizontal = { range: true, values: [['ss', 'ß', 'SS'], [10, 20, 30]] };
  for (let pass = 0; pass < 3; pass++) {
    expect(FUNCTIONS.VLOOKUP.fn(['ß', table, 2, false])).toBe(20);
    expect(FUNCTIONS.HLOOKUP.fn(['ß', horizontal, 2, false])).toBe(20);
    expect(FUNCTIONS.XLOOKUP.fn(['ß', keys, values, undefined, 0])).toBe(10);
    expect(FUNCTIONS.XLOOKUP.fn(['ß', keys, values, undefined, 0, -1])).toBe(30);
    expect(FUNCTIONS.XLOOKUP.fn(['ß', keys, values, undefined, 2])).toBe(20);
  }
});

it('retains an efficient exact index for Unicode queries', () => {
  const values = Array.from({ length: 4000 }, (_, i) => ['Straße' + i]);
  const run = indexed => {
    const start = performance.now(); let sum = 0;
    for (let i = 0; i < 200; i++) sum += FUNCTIONS.XMATCH.fn(['STRASSE' + ((i * 137) % values.length), { range: true, values: indexed ? values : values.slice() }, 0]);
    return { sum, ms: performance.now() - start };
  };
  const scanned = run(false), indexed = run(true);
  expect(indexed.sum).toBe(scanned.sum);
  expect(indexed.ms * 3).toBeLessThan(scanned.ms);
});
