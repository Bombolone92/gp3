// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { rowsFromHtml, rowsFromXml } from '../src/core/importrange.js';
import { parseInput } from '../src/core/format.js';

const PAGE = '<html><body><table><tr><th>Country</th><th>Pop (m)</th></tr><tr><td>France</td><td>68.2</td></tr><tr><td colspan="2">note</td></tr></table>'
  + '<table><tr><td>second</td></tr></table><ul><li>one</li><li>two</li></ul><ol><li>3</li></ol></body></html>';

describe('IMPORTHTML parsing', () => {
  it('accepts a tall table within the cell limit without overflowing function arguments', () => {
    const rows = rowsFromHtml(`<table>${'<tr><td>1</td></tr>'.repeat(150000)}</table>`, 'table', 1, parseInput);
    expect(rows).toHaveLength(150000);
    expect(rows[0]).toEqual([1]);
    expect(rows[149999]).toEqual([1]);
  }, 180000);

  it('stops expanding a wide table as soon as it exceeds the cell limit', () => {
    const parse = vi.fn(parseInput);
    const rows = rowsFromHtml(`<table>${'<tr><td colspan="1000">1</td></tr>'.repeat(500)}</table>`, 'table', 1, parse);
    expect(rows).toEqual({ error: '#NUM!' });
    expect(parse.mock.calls.length).toBeLessThanOrEqual(201);
  });

  it('keeps row-spanned cells in their columns, including rows covered entirely by a span', () => {
    const html = '<table><tr><th rowspan="3">Region</th><th colspan="2">Sales</th></tr>'
      + '<tr><td rowspan="2">10</td><td>20</td></tr><tr><td>30</td></tr>'
      + '<tr><td rowspan="2" colspan="3">note</td></tr><tr></tr></table>';
    expect(rowsFromHtml(html, 'table', 1, parseInput)).toEqual([
      ['Region', 'Sales', null], [null, 10, 20], [null, null, 30], ['note', null, null], [null, null, null],
    ]);
  });

  it.each(['0', '99999999999999999999'])('limits row span %s to its existing row group', (span) => {
    const html = `<table><tbody><tr><td rowspan="${span}">Group</td><td>1</td></tr><tr><td>2</td></tr></tbody>`
      + '<tbody><tr><td>Next</td><td>3</td></tr></tbody></table>';
    expect(rowsFromHtml(html, 'table', 1, parseInput)).toEqual([['Group', 1], [null, 2], ['Next', 3]]);
  });

  it.each(['200001', '99999999999999999999'])('bounds column span %s before expanding table cells', (span) => {
    const rows = rowsFromHtml(`<table><tr><td colspan="${span}">Value</td></tr></table>`, 'table', 1, parseInput);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveLength(1000);
    expect(rows[0][0]).toBe('Value');
  });

  it('reads the nth table as typed rows, padding short and spanned rows', () => {
    expect(rowsFromHtml(PAGE, 'table', 1, parseInput)).toEqual([['Country', 'Pop (m)'], ['France', 68.2], ['note', null]]);
    expect(rowsFromHtml(PAGE, 'table', 2, parseInput)).toEqual([['second']]);
    expect(rowsFromHtml(PAGE, 'table', 3, parseInput)).toEqual({ error: '#N/A' });
  });

  it('keeps words apart across line breaks and blocks inside a cell', () => {
    const html = '<table><tr><td>1<br>2</td><td><div>a</div><div>b</div></td><td><p>x</p>y</td><td>a<span>b</span>c</td><td>Total<table><tr><td>9</td></tr></table></td></tr></table>'
      + '<ul><li>one<br>two</li><li><p>3</p></li></ul>';
    expect(rowsFromHtml(html, 'table', 1, parseInput)).toEqual([['1 2', 'a b', 'x y', 'abc', 'Total 9']]);
    expect(rowsFromHtml(html, 'list', 1, parseInput)).toEqual([['one two'], [3]]);
  });

  it('reads the nth list as a column', () => {
    expect(rowsFromHtml(PAGE, 'list', 1, parseInput)).toEqual([['one'], ['two']]);
    expect(rowsFromHtml(PAGE, 'list', 2, parseInput)).toEqual([[3]]);
    expect(rowsFromHtml('<p>nothing</p>', 'list', 1, parseInput)).toEqual({ error: '#N/A' });
  });
});

describe('IMPORTXML parsing', () => {
  const XML = '<catalog><book id="1"><title>Dune</title><price>9.99</price></book><book id="2"><title>Emma</title><price>4.5</price></book></catalog>';
  it('picks nodes, attributes, and computed values by XPath', () => {
    expect(rowsFromXml(XML, '//book/title', parseInput)).toEqual([['Dune'], ['Emma']]);
    expect(rowsFromXml(XML, '//book/price', parseInput)).toEqual([[9.99], [4.5]]);
    expect(rowsFromXml(XML, '//book/@id', parseInput)).toEqual([[1], [2]]);
    expect(rowsFromXml(XML, 'count(//book)', parseInput)).toEqual([[2]]);
    expect(rowsFromXml(XML, '//nothing', parseInput)).toEqual({ error: '#N/A' });
    expect(rowsFromXml(XML, '//book[', parseInput)).toEqual({ error: '#VALUE!' });
  });

  it('falls back to HTML parsing for web pages', () => {
    expect(rowsFromXml(PAGE, '//li', parseInput)).toEqual([['one'], ['two'], [3]]);
  });
});
