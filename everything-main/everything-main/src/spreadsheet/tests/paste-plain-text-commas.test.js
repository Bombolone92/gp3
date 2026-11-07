import { afterEach, describe, it, expect } from 'vitest';
import { parseClipboard } from '../src/core/tsv.js';
import { setLocale } from '../src/core/format.js';

afterEach(() => setLocale('en-US'));

// Plain text pasted from anywhere splits on tabs only. Splitting on commas
// too turned "1,5" and "Hello, world" into two cells and made pasting a
// decimal impossible in comma-decimal locales.
describe('pasting plain text with commas', () => {
  it('keeps a single line with commas as one cell', () => {
    expect(parseClipboard('1,5')).toEqual([['1,5']]);
    expect(parseClipboard('Hello, world')).toEqual([['Hello, world']]);
    expect(parseClipboard('a,b\nc')).toEqual([['a,b'], ['c']]);
  });

  it('still splits a block of CSV lines with the same shape', () => {
    expect(parseClipboard('a,b\n1,2\n')).toEqual([['a', 'b'], ['1', '2']]);
    expect(parseClipboard('"x, y",1\nz,2')).toEqual([['x, y', '1'], ['z', '2']]);
  });

  it('never splits on commas where they are the decimal mark', () => {
    setLocale('de-DE');
    expect(parseClipboard('1,5\n2,5')).toEqual([['1,5'], ['2,5']]);
    expect(parseClipboard('a\tb\n1,5\t2,5')).toEqual([['a', 'b'], ['1,5', '2,5']]);
  });

  it('keeps thousands separators, amounts, and prose whole even across matching lines', () => {
    expect(parseClipboard('1,234\n5,678')).toEqual([['1,234'], ['5,678']]);
    expect(parseClipboard('1,234,567\n(2,345)\n')).toEqual([['1,234,567'], ['(2,345)']]);
    expect(parseClipboard('$1,234.50\n$5,678.00')).toEqual([['$1,234.50'], ['$5,678.00']]);
    expect(parseClipboard('Smith, John\nDoe, Jane')).toEqual([['Smith, John'], ['Doe, Jane']]);
    // A column of three-digit values after a label is still a table, as is a header over amounts.
    expect(parseClipboard('a,100\nb,200')).toEqual([['a', '100'], ['b', '200']]);
    expect(parseClipboard('Item,Amount\nRent,"$1,234.50"')).toEqual([['Item', 'Amount'], ['Rent', '$1,234.50']]);
  });

  it('prefers tabs whenever they are present', () => {
    expect(parseClipboard('a,b\tc\n1,2\t3')).toEqual([['a,b', 'c'], ['1,2', '3']]);
  });
});
