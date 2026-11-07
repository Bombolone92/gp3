// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { cellsToHtml, copyMergeLayout, parseHtmlClipboard } from '../src/core/clipboard.js';

it('retains horizontal and vertical foreign spans as merge ranges and rectangular cell data', () => {
  const parsed = parseHtmlClipboard('<table><tr><td rowspan="2">Left</td><td colspan="2">Top</td></tr><tr><td>B</td><td>C</td></tr></table>');
  expect(parsed.merges).toEqual([{ r1: 0, c1: 0, r2: 1, c2: 0 }, { r1: 0, c1: 1, r2: 0, c2: 2 }]);
  expect(parsed.rows.map(row => row.map(cell => cell.text))).toEqual([['Left', 'Top', ''], ['', 'B', 'C']]);
});

it('bounds row spans to their HTML row group and column spans to the DOM limit', () => {
  const parsed = parseHtmlClipboard('<table><tbody><tr><td rowspan="0">First</td><td>A</td></tr><tr><td>B</td></tr></tbody><tbody><tr><td rowspan="100">Next</td></tr></tbody></table>');
  expect(parsed.merges).toEqual([{ r1: 0, c1: 0, r2: 1, c2: 0 }]);
  const wide = parseHtmlClipboard('<table><tr><td colspan="99999">Wide</td></tr></table>');
  expect(wide.merges).toEqual([{ r1: 0, c1: 0, r2: 0, c2: 999 }]);
  expect(wide.rows[0]).toHaveLength(1000);
});

it('rejects a horizontal span crossing an occupied vertical span without overwriting cells', () => {
  const parsed = parseHtmlClipboard('<table><tr><td>A</td><td rowspan="2">B</td></tr><tr><td colspan="2">Crossing</td></tr></table>');
  expect(parsed.error).toMatch(/overlapping merged cells/);
});

it('uses the same compacted merge geometry for private, cross-tab and external HTML copies', () => {
  const mergeLayout = copyMergeLayout([{ r1: 2, c1: 1, r2: 5, c2: 4 }], [2, 5], [1, 3, 4]);
  expect(mergeLayout.ranges).toEqual([{ r1: 0, c1: 0, r2: 1, c2: 2 }]);
  const cells = [[{ f: 'SUM(A1:A2)', s: { bg: '#abcdef' } }, null, null], [null, null, null]];
  const html = cellsToHtml([['3', '', ''], ['', '', '']], cells, null, null, { r: 2, c: 1 }, { mergeLayout });
  expect(parseHtmlClipboard(html)).toEqual({ cells, origin: { r: 2, c: 1 }, merges: mergeLayout.ranges });
  const foreign = html.replace(/ data-spreadsheet-[\w-]+="[^"]*"/g, '');
  expect(parseHtmlClipboard(foreign).merges).toEqual(mergeLayout.ranges);
});

it('leaves unmerged clipboard results and private fast paths unchanged', () => {
  expect(parseHtmlClipboard('<table><tr><td>A</td></tr></table>').merges).toBeUndefined();
  const cells = [[{ v: 'A' }]];
  expect(parseHtmlClipboard(cellsToHtml([['A']], cells))).toEqual({ cells });
});
