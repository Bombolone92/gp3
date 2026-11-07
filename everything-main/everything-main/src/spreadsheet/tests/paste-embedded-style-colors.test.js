// @vitest-environment jsdom
import { stampClipboardHtml } from './helpers/clipboard.js';
import { describe, it, expect } from 'vitest';
import { parseHtmlClipboard } from '../src/core/clipboard.js';

// The cells embedded in copied HTML come from another tab of this app, but
// anything can put such an attribute on the clipboard. Colours are written
// into element styles by the toolbar and grid, so only hex colours may pass.
describe('colours in embedded pasted cells', () => {
  const embed = (cell) => parseHtmlClipboard(stampClipboardHtml(`<table data-spreadsheet-cells='${JSON.stringify([[cell]])}'><tr><td>Shown</td></tr></table>`));

  it('drops colour values that are not hex colours and keeps the rest of the style', () => {
    const parsed = embed({ v: 1, s: { color: 'url(https://evil.example/px?c)', bg: 'red; background-image: url(https://evil.example/b)', bc: 'javascript:alert(1)', bold: true, align: 'right' } });
    expect(parsed.cells).toEqual([[{ v: 1, s: { bold: true, align: 'right' } }]]);
  });

  it.each(['#112233', '#ABCDEF'])('keeps the hex colour %s', (hex) => {
    const parsed = embed({ v: 1, s: { color: hex, bg: hex, bc: hex } });
    expect(parsed.cells[0][0].s).toEqual({ color: hex, bg: hex, bc: hex });
  });

  it.each(['#fff', 'rgb(1, 2, 3)', 'red', '#12345', '#1234567', 12, true, ''])('rejects the colour %j', (bad) => {
    const parsed = embed({ v: 1, s: { color: bad, bg: bad, bc: bad, italic: true } });
    expect(parsed.cells[0][0].s).toEqual({ italic: true });
  });

  it('leaves a cell whose style held only bad colours with no style at all', () => {
    expect(embed({ v: 'x', s: { color: 'url(x)' } }).cells).toEqual([[{ v: 'x', s: undefined }]]);
    expect(embed(null).cells).toEqual([[null]]);
  });

  it('still reads only colours it can turn into hex from HTML styles', () => {
    const rows = parseHtmlClipboard('<table><tr><td style="color: url(https://evil.example/px); background: url(https://evil.example/b) red">x</td><td style="color: rgb(255, 0, 0); background-color: #ABC">y</td></tr></table>').rows[0];
    expect(rows[0].style).toEqual({ bg: '#ff0000' }); // the shorthand's colour, without its image
    expect(rows[1].style).toEqual({ color: '#ff0000', bg: '#aabbcc' });
  });
});
