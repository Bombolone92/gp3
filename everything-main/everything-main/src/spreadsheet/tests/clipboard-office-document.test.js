// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { cellsToHtml, cellsFromHtmlRows, parseHtmlClipboard } from '../src/core/clipboard.js';

it('binds Office types on the document and writes explicit text values without changing number formats', () => {
  const values = ['00041', 'TRUE', '=A1+2', '#N/A', '2/3/2027', '雪 & "quoted" <value>', "'literal", '  a\r\nb  ', 4.123456789];
  const cells = values.map(v => ({ v, f: null, s: { fmt: 'general' } }));
  const html = cellsToHtml([values.map(String)], [cells], null, [values]);
  const doc = new DOMParser().parseFromString(html, 'text/html');
  expect(doc.documentElement.getAttribute('xmlns:x')).toBe('urn:schemas-microsoft-com:office:excel');
  const tds = [...doc.querySelectorAll('td')];
  expect(tds.slice(0, -1).map(td => td.getAttribute('x:str'))).toEqual(values.slice(0, -1));
  expect(tds.at(-1).getAttribute('x:num')).toBe(String(values.at(-1)));
  expect(html).not.toContain('mso-number-format');
  expect(parseHtmlClipboard(html).cells).toEqual([cells]);
  const external = html.replace(/ data-spreadsheet-[\w-]+="[^"]*"/g, '');
  expect(cellsFromHtmlRows(parseHtmlClipboard(external).rows).map(x => x.cell.v)).toEqual(values);
  for (const attr of [...doc.querySelector('table').attributes]) doc.querySelector('table').removeAttribute(attr.name);
  // Serialization emits decoded CRLF literally; the Office reader preserves it.
  expect(cellsFromHtmlRows(parseHtmlClipboard(doc.documentElement.outerHTML).rows).map(x => x.cell.v))
    .toEqual(values);
});

it('copies a formula result as explicitly typed text externally and keeps the formula internally', () => {
  const cells = [[{ f: 'TEXT(A1,"0000")', s: { fmt: 'currency', cur: 'EUR' } }]], values = [['0042']];
  const html = cellsToHtml(values, cells, null, values);
  expect(parseHtmlClipboard(html).cells).toEqual(cells);
  const doc = new DOMParser().parseFromString(html, 'text/html');
  expect(doc.querySelector('td').getAttribute('x:str')).toBe('0042');
  expect(doc.querySelector('td').getAttribute('style')).toContain('mso-number-format:');
  for (const attr of [...doc.querySelector('table').attributes]) doc.querySelector('table').removeAttribute(attr.name);
  const external = cellsFromHtmlRows(parseHtmlClipboard(doc.documentElement.outerHTML).rows)[0].cell;
  expect(external.v).toBe('0042'); expect(external.f).toBeNull();
  expect(external.s.fmt).toBe('currency');
});

it('retains typed values beyond the optional format-hint and private-cell budgets', () => {
  const values = Array.from({ length: 20001 }, (_, i) => [i % 2 ? i + 0.123456789 : `00${i}`]);
  const html = cellsToHtml(values.map(row => row.map(String)), null, null, values);
  expect(html).not.toContain('data-spreadsheet-cells=');
  expect((html.match(/ x:str="/g) || []).length).toBe(10001);
  expect((html.match(/ x:num="/g) || []).length).toBe(10000);
  expect(html).toContain('x:str="0020000"');
  expect(html).toContain('x:num="19999.123456789"');
});

it('keeps private cells and exact values valid across varied escaped text and repeated formatting', () => {
  const values = Array.from({ length: 600 }, (_, i) => [`00${i} & "雪"\r\n <${i}>`]);
  const cells = values.map(([v]) => [{ v, f: null, s: { bold: true, color: '#224466' } }]);
  const html = cellsToHtml(values, cells, null, values);
  const serialized = new DOMParser().parseFromString(html, 'text/html').documentElement.outerHTML;
  expect(parseHtmlClipboard(html).cells).toEqual(cells);
  expect(parseHtmlClipboard(serialized).cells).toEqual(cells);
  expect(parseHtmlClipboard(serialized).values).toEqual(values);
});
