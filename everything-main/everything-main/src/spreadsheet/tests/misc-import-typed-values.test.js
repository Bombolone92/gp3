// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { rowsFromDelimited, rowsFromHtml, rowsFromXml } from '../src/core/importrange.js';
import { detectDelimiter } from '../src/core/io.js';
import { parseDelimited } from '../src/core/tsv.js';
import { parseInput, setLocale, getLocale } from '../src/core/format.js';

const helpers = { detectDelimiter, parseDelimited, parseInput };

// A spilled import carries no number format, so a date read as a serial showed as 46027.
it('keeps dates and times as text in web imports, while numbers, percents and prices become numbers', () => {
  expect(rowsFromDelimited('Date,Amount,Share,Price,At\n2026-01-05,"1,000",10%,$5,09:30\n', ',', helpers))
    .toEqual([['Date', 'Amount', 'Share', 'Price', 'At'], ['2026-01-05', 1000, 0.1, 5, '09:30']]);
  const html = '<table><tr><td>2026-01-05 09:30</td><td>68.2</td><td>=1+2</td></tr></table><ul><li>Jan 5, 2026</li></ul>';
  expect(rowsFromHtml(html, 'table', 1, parseInput)).toEqual([['2026-01-05 09:30', 68.2, '=1+2']]);
  expect(rowsFromHtml(html, 'list', 1, parseInput)).toEqual([['Jan 5, 2026']]);
  expect(rowsFromXml('<r><d>2026-01-05</d><n>4.5</n></r>', '//r/*', parseInput)).toEqual([['2026-01-05'], [4.5]]);
});

// Web imports read numbers as en-US whatever the user's locale; a file import uses the locale.
it('reads web imports in the user\'s locale, as file imports are read', () => {
  const before = getLocale();
  setLocale('de-DE');
  try {
    expect(rowsFromDelimited('a;b\n1,5;1.000\n', ';', helpers)).toEqual([['a', 'b'], [1.5, 1000]]);
    expect(rowsFromHtml('<table><tr><td>1,5</td></tr></table>', 'table', 1, parseInput)).toEqual([[1.5]]);
    expect(rowsFromXml('<r><n>1,5</n></r>', '//n', parseInput)).toEqual([[1.5]]);
  } finally { setLocale(before); }
  expect(rowsFromDelimited('a;b\n1,5;1.000\n', ';', helpers)).toEqual([['a', 'b'], ['1,5', 1]]);
});
