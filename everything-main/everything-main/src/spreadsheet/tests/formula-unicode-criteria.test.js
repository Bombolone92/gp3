import { expect, it } from 'vitest';
import { FUNCTIONS } from '../src/core/formula/functions.js';
import pairs from './fixtures/reference-text-comparison-unicode.json';
import oracle from './fixtures/reference-criteria-unicode.json';

const range = values => ({ range: true, values: values.map(v => [v]) });

it.each(pairs.cases)('matches native literal criteria across scan, index and cache: $a / $b', ({ a, b, expected }) => {
  const cells = range([a, b]);
  for (let pass = 0; pass < 3; pass++) {
    expect(FUNCTIONS.COUNTIF.fn([cells, a])).toBe(1 + (expected === 0));
    expect(FUNCTIONS.COUNTIF.fn([cells, b])).toBe(1 + (expected === 0));
  }
});

it.each(oracle.cases)('preserves native aggregate results and source accumulation order: $values', ({ values, weights, criteria, expected }) => {
  const cells = range(values), nums = range(weights);
  for (let pass = 0; pass < 3; pass++) for (const [i, criterion] of criteria.entries()) {
    const calls = [['COUNTIF', [cells, criterion]], ['COUNTIFS', [cells, criterion]],
      ['SUMIF', [cells, criterion, nums]], ['SUMIFS', [nums, cells, criterion]],
      ['AVERAGEIF', [cells, criterion, nums]], ['AVERAGEIFS', [nums, cells, criterion]],
      ['MAXIFS', [nums, cells, criterion]], ['MINIFS', [nums, cells, criterion]],
      ['COUNTIF', [cells, '<>' + criterion]], ['COUNTIF', [cells, '=' + criterion]]];
    for (const [j, [name, args]] of calls.entries()) expect(FUNCTIONS[name].fn(args), name).toEqual(expected[i][j]);
  }
});

it('keeps nontransitive prefix matches separate in the cached index', () => {
  const cells = range(['\u200b', '\ufe0f', '\u200b\u2060']);
  for (let pass = 0; pass < 4; pass++) {
    expect(FUNCTIONS.COUNTIF.fn([cells, '\u200b'])).toBe(2);
    expect(FUNCTIONS.COUNTIF.fn([cells, '\ufe0f'])).toBe(3);
    expect(FUNCTIONS.COUNTIF.fn([cells, '\u200b\u2060'])).toBe(2);
  }
});

it('recognizes error criteria before wildcard patterns and orders typed errors', () => {
  const codes = ['#NULL!', '#DIV/0!', '#VALUE!', '#REF!', '#NAME?', '#NUM!', '#N/A', '#GETTING_DATA', '#SPILL!', '#CONNECT!', '#BLOCKED!', '#UNKNOWN!', '#FIELD!', '#CALC!'];
  const cells = { range: true, values: codes.map(error => [{ error }, error]) };
  for (let pass = 0; pass < 3; pass++) for (const { criterion, expected } of oracle.errorCriteria) {
    expect(FUNCTIONS.COUNTIF.fn([cells, criterion]), criterion).toBe(expected);
  }
});

it('retains an efficient index for many distinct Unicode labels', () => {
  const cells = range(Array.from({ length: 5000 }, (_, i) => 'Straße' + i));
  const run = prefix => {
    const start = performance.now(); let count = 0;
    for (let i = 0; i < 200; i++) count += FUNCTIONS.COUNTIF.fn([cells, prefix + 'STRASSE' + i]);
    return { count, ms: performance.now() - start };
  };
  const scanned = run('<>'), indexed = run('');
  expect(indexed.count).toBe(200);
  expect(scanned.count + indexed.count).toBe(1000000);
  expect(indexed.ms * 3).toBeLessThan(scanned.ms);
});
