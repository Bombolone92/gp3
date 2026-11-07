// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { rowsFromHtml } from '../src/core/importrange.js';
import { parseInput } from '../src/core/format.js';

// A cell's text was every text node under it, so a <style> or <script> inside a cell, which the
// page never shows, came into the sheet as part of the value.
describe('IMPORTHTML hidden text', () => {
  it('leaves out script, style, template and noscript text inside a table cell', () => {
    const html = '<table><tr><td><style>.a{color:red}</style>Name</td><td><script>var x = 1;</script>7</td></tr>'
      + '<tr><td>Total<noscript>Enable scripts</noscript></td><td><span><template><b>draft</b></template>12</span></td></tr></table>';
    expect(rowsFromHtml(html, 'table', 1, parseInput)).toEqual([['Name', 7], ['Total', 12]]);
  });

  it('leaves them out of list items too', () => {
    const html = '<ul><li><style>li{margin:0}</style>one</li><li>two<script>track()</script></li></ul>';
    expect(rowsFromHtml(html, 'list', 1, parseInput)).toEqual([['one'], ['two']]);
  });
});
