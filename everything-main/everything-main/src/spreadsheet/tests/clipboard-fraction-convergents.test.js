// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { cellsToHtml, cellsFromHtmlRows, parseHtmlClipboard } from '../src/core/clipboard.js';
import { formatValue } from '../src/core/format.js';

it('copies convergent displays while preserving precise numeric values and format codes', () => {
  const values = [.06, -.06, .7, .006, .41421356237];
  const codes = ['?/?', '# ?/?', '?/?', '?/??', '?/????'];
  const cells = values.map((v, i) => ({ v, f: null, s: { fmt: 'custom', code: codes[i] } }));
  const displays = cells.map(cell => formatValue(cell.v, cell.s));
  expect(displays).toEqual(['0/1', '-0    ', '2/3', '0/1 ', '2378/5741']);
  const html = cellsToHtml([displays], [cells], null, [values]);
  expect(parseHtmlClipboard(html).cells).toEqual([cells]);
  const external = html.replace(/ data-spreadsheet-[\w-]+="[^"]*"/g, '');
  const restored = cellsFromHtmlRows(parseHtmlClipboard(external).rows).map(x => x.cell);
  expect(restored.map(c => c.v)).toEqual(values);
  expect(restored.map(c => c.s.code)).toEqual(codes);
  expect(restored.map(c => formatValue(c.v, c.s))).toEqual(displays);
});

it('imports native Office numeric fractions without replacing them with the displayed approximation', () => {
  const html = '<table><tr><td x:num="0.7" style="mso-number-format: &quot;?/?&quot;">2/3</td></tr></table>';
  const cell = cellsFromHtmlRows(parseHtmlClipboard(html).rows)[0].cell;
  expect(cell.v).toBe(.7);
  expect(formatValue(cell.v, cell.s)).toBe('2/3');
});
