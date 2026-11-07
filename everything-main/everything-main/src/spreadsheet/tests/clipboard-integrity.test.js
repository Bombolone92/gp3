// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { cellsToHtml, parseHtmlClipboard, cellsFromHtmlRows, isOwnHtmlClipboard } from '../src/core/clipboard.js';
import { Workbook } from '../src/core/workbook.js';
import { workbookToXlsx, workbookFromFile } from '../src/core/io.js';
import * as X from '../src/vendor/xlsx.mjs';

const copied = () => cellsToHtml([['#VALUE!']], [[{ f: 'MINVERSE(A1:B1)', s: { bold: true } }]], null,
  [[{ error: '#VALUE!' }]], { r: 4, c: 2 }).replace('<table', '<table data-spreadsheet-copy="copy-id"');

it.each(['<td class="foreign">#VALUE!</td>', '<td x:num="42">42</td>', '<td>Current</td><td>cells</td>'])
  ('ignores a stale formula, value snapshot, origin, and copy token after cells change: %s', (cells) => {
    const doc = new DOMParser().parseFromString(copied(), 'text/html');
    doc.querySelector('tr').innerHTML = cells;
    const html = doc.body.innerHTML;
    const parsed = parseHtmlClipboard(html);
    expect(parsed.cells).toBeUndefined();
    expect(parsed.values).toBeUndefined();
    expect(parsed.origin).toBeUndefined();
    expect(parsed.rows[0][0].text).toBe(doc.querySelector('td').textContent);
    expect(isOwnHtmlClipboard(html, 'copy-id')).toBe(false);
  });

it('uses current external formatting and values when stale metadata survives an application round trip', () => {
  const doc = new DOMParser().parseFromString(copied(), 'text/html');
  doc.querySelector('tr').innerHTML = '<td class="current" x:num="0.2468">24.7%</td>';
  const html = `<style>.current{font-family:Geneva;font-size:12pt;mso-number-format:Percent}</style>${doc.body.innerHTML}`;
  const parsed = parseHtmlClipboard(html);
  expect(cellsFromHtmlRows(parsed.rows)[0].cell).toMatchObject({ v: 0.2468, f: null, s: { font: 'font:Geneva', size: 16, fmt: 'percent' } });
});

it.each([
  html => html.replace('<table ', '<table style="font-size:18pt" '),
  html => `<div style="font-size:18pt">${html}</div>`,
  html => `<style>td{font-size:18pt}</style>${html}`,
])('reads new formatting outside the table body instead of stale cell styles %#', (change) => {
  const html = change(copied());
  expect(parseHtmlClipboard(html).rows[0][0].style.size).toBe(24);
  expect(isOwnHtmlClipboard(html, 'copy-id')).toBe(false);
});

it('falls back to visible cells for unsigned old metadata and unknown or damaged stamps', () => {
  for (const stamp of ['', '2:future', '1:invalid']) {
    const doc = new DOMParser().parseFromString(copied(), 'text/html');
    doc.querySelector('table').setAttribute('data-spreadsheet-markup', stamp);
    expect(parseHtmlClipboard(doc.body.innerHTML).rows[0][0].text).toBe('#VALUE!');
    expect(isOwnHtmlClipboard(doc.body.innerHTML, 'copy-id')).toBe(false);
  }
});

it('keeps formulas and snapshots through browser serialization, document wrapping, and attribute spelling', () => {
  const cells = [[{ f: 'SUM(A1:A5)', s: { bg: '#123456', wrap: true } }, { v: '00123' }]];
  const values = [['  "<&\u00a0漢😀>\nsecond  line  ', '00123']];
  const html = cellsToHtml(values, cells, null, values, { r: 3, c: 8 });
  const doc = new DOMParser().parseFromString(html, 'text/html');
  for (const td of doc.querySelectorAll('td')) {
    const attrs = Array.from(td.attributes, a => [a.name, a.value]).reverse();
    for (const [name] of attrs) td.removeAttribute(name);
    for (const [name, value] of attrs) td.setAttribute(name, value);
  }
  const serialized = doc.body.innerHTML.replace('x:str=""', 'x:str').replace(/&nbsp;/g, '&#160;');
  expect(parseHtmlClipboard(`<html><body><!--StartFragment-->${serialized}<!--EndFragment--></body></html>`))
    .toEqual({ cells, values, origin: { r: 3, c: 8 } });
});

it('covers merged cells, hyperlinks, and conditional appearances without changing embedded styles', () => {
  const cells = [[{ f: 'HYPERLINK("https://example.test/?a=1&b=2","Link")', s: { bold: false } }, null], [null, { v: 'Data' }]];
  const html = cellsToHtml([['Link', ''], ['', 'Data']], cells, [[{ bg: '#123456' }]], null, null,
    { merges: [{ r1: 0, c1: 0, r2: 1, c2: 0 }], rows: [0, 1], cols: [0, 1] });
  const serialized = new DOMParser().parseFromString(html, 'text/html').body.innerHTML;
  expect(parseHtmlClipboard(serialized).cells).toEqual(cells);
});

it.each(['a\0b', 'a\rb', 'a\r\nb', '<>"\'&nbsp;&#13;', '\u0001\u000c\u0080', '漢😀\u2028\u2029'])
  ('retains exact values despite HTML source preprocessing: %j', (value) => {
    const cells = [[{ v: value }]], values = [[value]];
    const html = cellsToHtml(values, cells, null, values);
    const serialized = new DOMParser().parseFromString(html, 'text/html').body.innerHTML;
    expect(parseHtmlClipboard(serialized)).toEqual({ cells, values });
  });

it('does not use a large stale values-only snapshot to overwrite the current table', { timeout: 60000 }, () => {
  const values = Array.from({ length: 5001 }, () => [7]);
  const html = cellsToHtml(values, values.map(([v]) => [{ v }]), null, values);
  const changed = html.replace('x:num="7"', 'x:num="9"').replace('>7</td>', '>9</td>');
  const parsed = parseHtmlClipboard(changed);
  expect(parsed.values).toBeUndefined();
  expect(parsed.rows[0][0].value).toBe(9);
});

it('exports the current foreign value as a native XLSX error without reviving the stale formula', async () => {
  const html = copied().replace(/<td\b[^>]*>/, '<td class="current">');
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setCells(id, cellsFromHtmlRows(parseHtmlClipboard(html).rows).map(({ i, j, cell }) => ({ r: i + 2, c: j + 4, cell })));
  const blob = await workbookToXlsx(wb);
  const data = await new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsArrayBuffer(blob); });
  const native = X.read(new Uint8Array(data), { type: 'array' });
  const error = native.Sheets[native.SheetNames[0]].E3;
  expect(error).toMatchObject({ t: 'e', v: 15 });
  expect(error.f).toBeUndefined();
  const back = await workbookFromFile(new Uint8Array(data), 'clipboard.xlsx');
  expect(back.getValue(back.activeSheetId, 2, 4)).toEqual({ error: '#VALUE!' });
  expect(back.getCell(back.activeSheetId, 2, 4).f).toBeNull();
});
