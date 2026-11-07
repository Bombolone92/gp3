// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { cellsToHtml, cellsFromHtmlRows, parseHtmlClipboard } from '../src/core/clipboard.js';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';

const fromHtml = html => cellsFromHtmlRows(parseHtmlClipboard(html).rows)[0].cell;
const sized = value => fromHtml(`<table><tr><td style="font-size:${value}">Heading</td></tr></table>`);

it.each([
  ['24px', 24], ['10.5pt', 14], ['.25in', 24], ['2pc', 32],
  ['2.54cm', 96], ['25.4mm', 96], ['101.6Q', 96], ['1.25e1px', 12.5],
  ['409pt', 409 * 4 / 3],
])('reads explicit absolute CSS font sizes: %s', (value, expected) => {
  expect(sized(value).s?.size).toBeCloseTo(expected, 10);
});

it('resolves cell classes before inline font size without rounding fractional pixels', () => {
  const cell = fromHtml('<style>.heading{font-size:18pt}.small{font-size:9pt}</style>'
    + '<table><tr><td class="heading small" style="font-size:10pt">Title</td></tr></table>');
  expect(cell.s.size).toBeCloseTo(40 / 3, 12);
  expect(fromHtml('<style>.heading{font-size:18pt}</style><table><tr><td class="heading">Title</td></tr></table>').s.size).toBe(24);
});

it.each(['-12px', '0px', 'NaNpx', '1e400px', '10000px', '12', '12px trailing', 'inherit', '200%', '2em'])('does not invent an absolute size for %s', value => {
  expect(sized(value).s?.size).toBeUndefined();
});

it('retains large and fractional sizes through external HTML and native XLSX', async () => {
  for (const size of [4 / 3, 40 / 3, 14, 24, 409 * 4 / 3]) {
    const style = { font: 'font:Book Antiqua', size, bold: true };
    const html = cellsToHtml([['Heading']], [[{ v: 'Heading', s: style }]], [[style]])
      .replace(/ data-spreadsheet-[\w-]+="[^"]*"/g, '');
    const element = new DOMParser().parseFromString(html, 'text/html').querySelector('td');
    expect(element.style.fontSize.endsWith('pt')).toBe(true);
    expect(parseFloat(element.style.fontSize)).toBeCloseTo(size * 3 / 4, 10);
    expect(element.style.fontWeight).toBe('bold');
    const pasted = fromHtml(html);
    expect(pasted.s).toMatchObject({ font: style.font, bold: true });
    expect(pasted.s.size).toBeCloseTo(size, 10);
    const wb = new Workbook({ sheets: [{ name: 'Data', cells: { '0,0': pasted } }] });
    const blob = await workbookToXlsx(wb);
    const bytes = await new Promise(resolve => { const r = new FileReader(); r.onload = () => resolve(r.result); r.readAsArrayBuffer(blob); });
    // Read the written native style, with no metadata-based restoration.
    const X = await import('../src/vendor/xlsx.mjs');
    const zip = X.CFB.read(new Uint8Array(bytes), { type: 'array' });
    const xml = path => new DOMParser().parseFromString(new TextDecoder().decode(X.CFB.find(zip, path).content), 'application/xml');
    const styles = xml('/xl/styles.xml'), sheet = xml('/xl/worksheets/sheet1.xml');
    const xf = styles.querySelector('cellXfs').children[Number(sheet.querySelector('c[r="A1"]').getAttribute('s'))];
    const font = styles.querySelector('fonts').children[Number(xf.getAttribute('fontId'))];
    expect(Number(font.querySelector('sz').getAttribute('val'))).toBeCloseTo(size * 3 / 4, 10);
    expect(font.querySelector('name').getAttribute('val')).toBe('Book Antiqua');
    const reopened = await workbookFromFile(bytes, 'pasted.xlsx');
    expect(reopened.styleAt(reopened.activeSheetId, 0, 0).size).toBeCloseTo(size, 10);
  }
});
