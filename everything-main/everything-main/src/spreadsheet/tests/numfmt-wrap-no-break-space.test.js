import { afterEach, expect, it } from 'vitest';
import { wrapLines } from '../src/core/textfit.js';
import { formatValue, setLocale } from '../src/core/format.js';

const measure = (t) => t.length * 10; // 10px per character

afterEach(() => setLocale('en-US'));

it.each([['no-break space', ' '], ['narrow no-break space', ' ']])('keeps a number grouped with a %s on one line', (_, nbsp) => {
  expect(wrapLines(`x 1${nbsp}234`, 60, measure)).toEqual(['x', `1${nbsp}234`]);
  expect(wrapLines(`1${nbsp}234 kg`, 60, measure)).toEqual([`1${nbsp}234`, 'kg']);
  expect(wrapLines(`Total: 12${nbsp}345${nbsp}678 units`, 110, measure)).toEqual(['Total:', `12${nbsp}345${nbsp}678`, 'units']);
});

it('wraps a French-formatted amount as one word', () => {
  setLocale('fr-FR');
  const amount = formatValue(1234567.5, { fmt: 'number', dec: 2 });
  expect(amount).toMatch(/^1 234 567,50$/);
  expect(wrapLines(`Montant ${amount}`, 130, measure)).toEqual(['Montant', amount]);
});

it('still breaks at ordinary spaces, tabs, and explicit line breaks', () => {
  expect(wrapLines('the quick\tbrown fox', 100, measure)).toEqual(['the quick', 'brown fox']);
  expect(wrapLines('a\nb c', 100, measure)).toEqual(['a', 'b c']);
  expect(wrapLines('ab  cd', 20, measure)).toEqual(['ab', 'cd']);
});
