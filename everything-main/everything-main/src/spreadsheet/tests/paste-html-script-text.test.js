// @vitest-environment jsdom
import { it, expect } from 'vitest';
import { parseHtmlClipboard } from '../src/core/clipboard.js';

// Pasted HTML is parsed inertly, but the text of <script> and <style> elements
// inside a cell was still read as the cell's text.
it('does not turn script and style contents into cell text', () => {
  const parsed = parseHtmlClipboard('<table><tr><td>a<script>alert(1)</script></td><td><style>td{}</style>c</td><td><noscript>n</noscript>d</td></tr></table>');
  expect(parsed.rows.map((row) => row.map((cell) => cell.text))).toEqual([['a', 'c', 'd']]);
});
