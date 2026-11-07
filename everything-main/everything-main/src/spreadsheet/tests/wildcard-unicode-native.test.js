import { expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { calcValues } from './helpers/calc.js';
import { FUNCTIONS } from '../src/core/formula/functions.js';
import { foldedTextWindows, foldPrefixText, foldComparisonText } from '../src/core/formula/text-comparison.js';
import oracle from './fixtures/reference-wildcard-unicode.json';

it.each(oracle.cases)('matches native wildcard/escape semantics: $pattern / $text', ({ pattern, text, expected }) => {
  const cells = { A1: text, B1: pattern };
  for (const [i, formula] of ['COUNTIF(A1,B1)', 'SEARCH(B1,A1)', 'MATCH(B1,A1,0)', 'XMATCH(B1,A1,2)'].entries()) {
    expect(calcValues(formula, cells), formula).toEqual(expected[i]);
  }
  const range = { range: true, values: [[text]] };
  for (let pass = 0; pass < 3; pass++) {
    expect(FUNCTIONS.COUNTIF.fn([range, pattern])).toEqual(expected[0]);
    expect(FUNCTIONS.MATCH.fn([pattern, range, 0])).toEqual(expected[2]);
    expect(FUNCTIONS.XMATCH.fn([pattern, range, 2])).toEqual(expected[3]);
  }
});

it.each(oracle.countif)('matches native Unicode wildcard spans: $pattern / $text', ({ pattern, text, expected }) => {
  const range = { range: true, values: [[text]] };
  expect(FUNCTIONS.COUNTIF.fn([range, pattern])).toBe(expected);
});

it('folds arbitrary windows without moving UTF-16 boundaries or combining sequences', () => {
  const alphabet = ['A', 'é', 'e', 'İ', 'ı', 'ß', 'Ａ', 'ﬃ', 'ᾀ', '\u0345', '\u0315', '\u0300', '\u0327', 'ｶ', 'ﾞ', '😀', '𝐀', '\u200b', '\uD800', '\uDC00'];
  let seed = 71;
  const next = n => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
  for (let sample = 0; sample < 150; sample++) {
    const text = Array.from({ length: 8 }, () => alphabet[next(alphabet.length)]).join('');
    const window = foldedTextWindows(text);
    for (let from = 0; from <= text.length; from++) for (let to = from; to <= text.length; to++) {
      const raw = text.slice(from, to);
      expect(window(from, to)).toEqual([foldPrefixText(raw), foldComparisonText(raw)]);
    }
  }
});

it('keeps long Unicode searches bounded without repeated full substring folding', () => {
  const script = `
    import { wildcardMatcher } from './src/core/formula/wildcard.js';
    const cases = [
      ['*' + 'Ａ'.repeat(8000) + 'b*', 'a'.repeat(16000) + 'ç'],
      ['*' + 'é'.repeat(8000) + 'b*', 'é'.repeat(16000)],
      ['*a'.repeat(15) + 'b', 'a'.repeat(40)],
    ];
    console.log(JSON.stringify(cases.map(([pattern, text]) => {
      const match = wildcardMatcher(pattern);
      return [match(text), match.searchFrom(text, 0, true)];
    })));
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: new URL('../', import.meta.url), encoding: 'utf8', timeout: 2500,
  });
  expect(result.error?.code, 'Unicode wildcard search exceeded its isolated time limit').toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual([[false, -1], [false, -1], [false, -1]]);
});
