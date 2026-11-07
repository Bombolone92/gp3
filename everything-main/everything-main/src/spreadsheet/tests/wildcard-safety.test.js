import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';
import { criteriaMatcher } from '../src/core/formula/functions.js';

it.each([
  ['a*a', 'a', false], ['a*a', 'aA', true], ['*?*', '', false],
  ['*?*', '\n', true], ['a*a*a', 'aa', false], ['a*a*a', 'aaa', true],
  ['*~**', 'a*b', true], ['**a**b**', 'A\nB', true],
  // Native Excel wildcards consume UTF-16 units in both Compatibility Versions.
  ['?', '😀', false], ['??', '😀', true], ['?x', '😀x', false], ['??x', '😀x', true],
])('matches %s against %j without overlapping pattern pieces', (pattern, value, expected) => {
  expect(criteriaMatcher('=' + pattern)(value)).toBe(expected);
});

it('finishes adversarial wildcard criteria, lookups, and searches without blocking', () => {
  // Isolate the reproduction so a regression cannot hang the test runner.
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { Workbook } from './src/core/workbook.js';
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, 'a'.repeat(40));
    wb.setInput(id, 1, 0, 'a'.repeat(40) + 'b');
    wb.setInput(id, 0, 1, '*a'.repeat(15) + 'b');
    const formulas = [
      'COUNTIF(A1:A1,B1)', 'COUNTIF(A1:A2,B1)', 'MATCH(B1,A1:A2,0)',
      'XMATCH(B1,A1:A2,2)', 'XLOOKUP(B1,A1:A2,{10;20},,2)',
      'VLOOKUP(B1,A1:A2,1,FALSE)', 'SEARCH(B1,A1)', 'SEARCH(B1,A2)',
    ];
    console.log(JSON.stringify(formulas.map((formula, i) => {
      wb.setInput(id, i, 2, '=' + formula);
      return wb.getValue(id, i, 2);
    })));
  `], { cwd: new URL('../', import.meta.url), encoding: 'utf8', timeout: 2000 });
  expect(result.error?.code, 'Wildcard evaluation exceeded its isolated time limit').toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual([0, 1, 2, 2, 20, 'a'.repeat(40) + 'b', { error: '#VALUE!' }, 1]);
});

it('preserves printable ASCII wildcard semantics on bounded random patterns', () => {
  // Independent regex oracle for printable ASCII. Native Unicode/escape
  // controls are covered by the separate recorded Excel fixture.
  const original = (pattern) => {
    let re = '';
    const chars = [...pattern];
    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i];
      if (ch === '~') { if (i + 1 < chars.length) re += chars[++i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); continue; }
      re += ch === '*' ? '.*' : ch === '?' ? '.' : ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    return new RegExp(`^${re}(?![\\s\\S])`, 'is');
  };
  let seed = 19;
  const next = (limit) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % limit; };
  const chars = ['a', 'A', 'b', '*', '?', '~', '.', '['];
  const randomText = () => Array.from({ length: next(9) }, () => chars[next(chars.length)]).join('');
  // Collect mismatches instead of asserting per case: 8000 assertions cost
  // enough to time the test out when the whole suite runs in parallel.
  const mismatches = [];
  for (let i = 0; i < 2000; i++) {
    const pattern = randomText() + '*' + randomText();
    const match = criteriaMatcher('=' + pattern);
    const oracle = original(pattern);
    for (const value of [randomText(), pattern.replace(/[*?~]/g, ''), '', 'a\nb']) {
      const actual = match(value);
      const expected = oracle.test(value);
      if (actual !== expected) mismatches.push({ pattern, value, actual, expected });
    }
  }
  expect(mismatches).toEqual([]);
}, 30_000);

it('retains Unicode case folding without changing wildcard widths', () => {
  for (const [pattern, text, expected] of [
    ['𐐨?', '𐐀x', true], ['𐐀?', '𐐨x', true], ['??x', '𐐀x', true], ['?x', '𐐀x', false],
    ['k?', 'Kx', true], ['K?', 'Kx', true], ['s?', 'ſx', true], ['ſ?', 'Sx', true],
    ['i?', 'İx', false], ['i?', 'ıx', false], ['ss?', 'ßx', false],
  ]) expect(criteriaMatcher(pattern)(text), `${pattern}: ${text}`).toBe(expected);
});
