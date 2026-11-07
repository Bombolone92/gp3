// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { parseHtmlClipboard } from '../src/core/clipboard.js';
import { rowsFromHtml } from '../src/core/importrange.js';
import { parseInput } from '../src/core/format.js';

const parsers = [
  ['clipboard', (html) => parseHtmlClipboard(html).rows.map((row) => row.map((cell) => cell.text))],
  ['IMPORTHTML', (html) => rowsFromHtml(html, 'table', 1, parseInput)],
];

describe.each(parsers)('%s table row order', (name, parse) => {
  it.each([
    ['thead', 'tbody', 'tfoot'], ['thead', 'tfoot', 'tbody'],
    ['tbody', 'thead', 'tfoot'], ['tbody', 'tfoot', 'thead'],
    ['tfoot', 'thead', 'tbody'], ['tfoot', 'tbody', 'thead'],
  ])('orders %s / %s / %s by displayed section', (...order) => {
    const html = `<table>${order.map((tag) => `<${tag}><tr><td>${tag}</td></tr></${tag}>`).join('')}</table>`;
    expect(parse(html)).toEqual([['thead'], ['tbody'], ['tfoot']]);
  });

  it('retains body group order and keeps reordered row spans within each section', () => {
    const html = '<table><tfoot><tr><td rowspan="0">Footer</td><td>F1</td></tr><tr><td>F2</td></tr></tfoot>'
      + '<tbody><tr><td rowspan="99">Body A</td><td>A1</td></tr><tr><td>A2</td></tr></tbody>'
      + '<thead><tr><th rowspan="0">Header</th><th>H1</th></tr><tr><th>H2</th></tr></thead>'
      + '<tbody><tr><td>Body B</td><td>B1</td></tr></tbody></table>';
    const blank = name === 'clipboard' ? '' : null;
    expect(parse(html)).toEqual([
      ['Header', 'H1'], [blank, 'H2'], ['Body A', 'A1'], [blank, 'A2'], ['Body B', 'B1'],
      ['Footer', 'F1'], [blank, 'F2'],
    ]);
  });

  it('does not promote nested table rows into the outer table', () => {
    const html = '<table><tfoot><tr><td>Footer</td></tr></tfoot>'
      + '<tbody><tr><td><table><thead><tr><th>Nested</th></tr></thead></table></td></tr></tbody>'
      + '<thead><tr><th>Header</th></tr></thead></table>';
    expect(parse(html)).toEqual([['Header'], ['Nested'], ['Footer']]);
  });
});

it('retains clipboard styles and typed import values when reordering rows', () => {
  const html = '<table><tfoot><tr><td>30</td></tr></tfoot>'
    + '<tbody><tr><td>20</td></tr></tbody><thead><tr><th style="font-weight:bold">10</th></tr></thead></table>';
  const rows = parseHtmlClipboard(html).rows;
  expect(rows.map((row) => row[0].text)).toEqual(['10', '20', '30']);
  expect(rows[0][0].style.bold).toBe(true);
  expect(rowsFromHtml(html, 'table', 1, parseInput)).toEqual([[10], [20], [30]]);
});
