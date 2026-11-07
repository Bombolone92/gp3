// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { cellsToHtml, parseHtmlClipboard, cellsFromHtmlRows } from '../src/core/clipboard.js';
import { stampClipboardHtml } from './helpers/clipboard.js';

// A text cell whose value equalled its displayed text (every plain text cell) went out with a bare x:str,
// so the reader took its value from the <td>, where HTML had collapsed the spaces: "  lead" came back as
// "lead", "a  b" as "a b" and "trail  " as "trail", and a\r\nb as a\n\nb since only \n became a <br>. The
// values snapshot on the same table carried the originals but was not consulted for those cells.
const TEXTS = ['  lead', 'a  b', 'trail  ', 'a\r\nb', 'x y', 'plain', 'two\nlines'];
const strip = (html) => html.replace(/ data-spreadsheet-(cells|values|origin)="[^"]*"/g, '');
const values = (html) => parseHtmlClipboard(html).rows[0].map((cell) => cell.value);
const tds = (html) => [...new DOMParser().parseFromString(html, 'text/html').querySelectorAll('td')];

describe('spaces and line ends in copied text', () => {
  it.each([false, true])('preserves text and wrap=%s without private metadata', wrap => {
    const cells = [TEXTS.map(v => ({ v, f: null, s: { wrap } }))];
    const html = cellsToHtml([TEXTS], cells, null, [TEXTS]);
    const attrs = tds(html).map(td => td.getAttribute('x:str'));
    expect(attrs).toEqual(TEXTS);
    expect(tds(html)[5].textContent).toBe('plain');
    expect(tds(html)[6].querySelectorAll('br')).toHaveLength(1);
    expect(tds(html)[6].querySelector('br').style.display).toBe(wrap ? '' : 'none');
    expect(html.replace(/<[^>]*>/g, '<>')).not.toMatch(/\r/);
    const external = strip(html);
    expect(values(external)).toEqual(TEXTS);
    const pasted = cellsFromHtmlRows(parseHtmlClipboard(external).rows).map(({ cell }) => cell);
    expect(pasted[0]).toEqual({ v: '  lead', f: null, s: { wrap, valign: 'middle' } });
    expect(pasted[3]).toEqual({ v: 'a\r\nb', f: null, s: { wrap, valign: 'middle' } });
  });

  it('lets the values snapshot restore what a bare x:str lost, and leaves a named x:str and typed numbers alone', () => {
    const html = stampClipboardHtml(`<table data-spreadsheet-values='[["  lead","a  b","kept",7]]'><tr><td x:str>lead</td><td x:str>a b</td><td x:str="kept">other</td><td x:num="7.5">7.5</td></tr></table>`);
    expect(values(html)).toEqual(['  lead', 'a  b', 'kept', 7.5]);
  });
});
