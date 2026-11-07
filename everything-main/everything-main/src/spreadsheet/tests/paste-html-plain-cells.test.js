// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { parseHtmlClipboard } from '../src/core/clipboard.js';

// Cells without markup inside take a shorter path through the parser; they
// must read exactly as the same content wrapped in an inline element does.
describe('plain pasted cells', () => {
  const both = (inner, attrs = '') => {
    const plain = parseHtmlClipboard(`<table><tr><td ${attrs}>${inner}</td></tr></table>`).rows[0][0];
    const wrapped = parseHtmlClipboard(`<table><tr><td ${attrs}><span>${inner}</span></td></tr></table>`).rows[0][0];
    return { plain, wrapped };
  };

  it('reads text, entities and whitespace the same with and without inline markup', () => {
    for (const inner of ['  Ann  Lee ', 'a&amp;b &lt;c&gt;', '1,234.5', ' \n\t x \t\n ', '', 'caf&eacute;']) {
      const { plain, wrapped } = both(inner);
      expect(plain, inner).toEqual(wrapped);
    }
    expect(both('a  b').plain.text).toBe('a b');
    const nbsp = both('a\u00a0\u00a0b');
    expect(nbsp.plain).toEqual(nbsp.wrapped);
    expect(nbsp.plain.text).toBe('a\u00a0\u00a0b');
  });

  it('reads inline styles and attributes the same', () => {
    const attrs = 'style="font-weight: 700; font-style: italic; text-decoration: underline line-through; color: rgb(0, 128, 0); background: #ffff00; text-align: right; font-family: Georgia; white-space: pre-wrap" bgcolor="#ff0000"';
    const { plain, wrapped } = both('x', attrs);
    expect(plain).toEqual(wrapped);
    expect(plain.style).toEqual({ bold: true, italic: true, underline: true, strike: true, color: '#008000', bg: '#ffff00', align: 'right', font: 'georgia', wrap: true });
    expect(both('x', 'align="center"').plain.style).toEqual({ align: 'center' });
  });

  it('marks a header cell bold and retains declared normal wrapping with or without inline markup', () => {
    const rows = parseHtmlClipboard('<table><tr><th>H</th><td style="white-space:normal">a<br>b</td><td style="white-space:normal">plain</td><td style="white-space:normal"><b>bold</b></td></tr></table>').rows[0];
    expect(rows.map((cell) => cell.style)).toEqual([{ bold: true }, { wrap: true }, { wrap: true }, { bold: true, wrap: true }]);
    expect(rows[1].text).toBe('a\nb');
  });

  it('reads styling from inline elements only when they are there', () => {
    const rows = parseHtmlClipboard('<table><tr><td><b>a</b></td><td><em>b</em></td><td><u>c</u></td><td><del>d</del></td><td>e</td></tr></table>').rows[0];
    expect(rows.map((cell) => cell.style)).toEqual([{ bold: true }, { italic: true }, { underline: true, strike: false }, { strike: true, underline: false }, undefined]);
  });
});
