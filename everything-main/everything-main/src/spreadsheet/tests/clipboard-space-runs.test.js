// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { cellsToHtml, parseHtmlClipboard, cellsFromHtmlRows } from '../src/core/clipboard.js';

const parse = content => parseHtmlClipboard(`<table><tr><td>${content}</td></tr></table>`).rows[0][0];
const external = html => html.replace(/ data-spreadsheet-[\w-]+="[^"]*"/g, '').replace(/ x:str(?:="[^"]*")?/g, '');

it('reads Office space runs while still collapsing their HTML source indentation', () => {
  const content = '<span style="mso-spacerun:yes">&nbsp; </span>alpha<span style="mso-spacerun:yes">&nbsp;\r\n  </span>beta<span style="mso-spacerun:yes">&nbsp;&nbsp;</span>';
  expect(parse(content).text).toBe('  alpha  beta  ');
  expect(parse('before\n<span style="mso-spacerun:yes">&nbsp;&nbsp;</span>after').text).toBe('before   after');
  expect(parse('<span style="mso-spacerun:no">&nbsp;&nbsp;</span>x').text).toBe('\u00a0\u00a0x');
  expect(parse('<span style="MSO-SPACERUN:YES">&nbsp;</span>x').text).toBe(' x');
});

it.each([false, true])('exports significant spaces through standard HTML markup with wrap=%s', wrap => {
  const texts = [];
  for (const count of [1, 2, 5, 12]) {
    const spaces = ' '.repeat(count);
    texts.push(spaces + 'start', 'middle' + spaces + 'word', 'end' + spaces, spaces, spaces + 'one\n' + spaces + 'two' + spaces);
  }
  const html = cellsToHtml([texts], [texts.map(v => ({ v, f: null, s: { wrap } }))], null, [texts]);
  const plain = external(html);
  expect(parseHtmlClipboard(plain).rows[0].map(c => c.text)).toEqual(texts);
  const doc = new DOMParser().parseFromString(plain, 'text/html');
  expect(doc.querySelectorAll('[style*="mso-spacerun"]').length).toBeGreaterThan(texts.length);
  // Ordinary single word separators keep normal HTML break opportunities.
  const simple = cellsToHtml([['one two']], [[{ v: 'one two' }]]);
  expect(simple).not.toContain('mso-spacerun');
  expect(simple).toContain('one two</td>');
});

it('escapes markup-bearing text independently of its significant spaces', () => {
  const value = ' <a>  & "quoted"  </a> ';
  const html = external(cellsToHtml([[value]], [[{ v: value }]], null, [[value]]));
  const doc = new DOMParser().parseFromString(html, 'text/html');
  expect(doc.querySelector('a')).toBeNull();
  expect(parseHtmlClipboard(html).rows[0][0].text).toBe(value);
});

it('retains exact typed space-only values without relying on private payloads', () => {
  const values = [' ', '   ', ' leading', 'two  words', 'trailing '];
  const html = cellsToHtml([values], [values.map(v => ({ v }))], null, [values]).replace(/ data-spreadsheet-[\w-]+="[^"]*"/g, '');
  expect(cellsFromHtmlRows(parseHtmlClipboard(html).rows).map(x => x.cell.v)).toEqual(values);
});
