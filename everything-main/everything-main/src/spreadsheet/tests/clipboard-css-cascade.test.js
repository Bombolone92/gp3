// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { parseHtmlClipboard, cellsFromHtmlRows, cellsToHtml } from '../src/core/clipboard.js';
import { Workbook } from '../src/core/workbook.js';
import { workbookToXlsx, workbookFromFile } from '../src/core/io.js';
import * as X from '../src/vendor/xlsx.mjs';

const parse = (css, cells, before = '', after = '') => parseHtmlClipboard(`<style>${css}</style>${before}<table><tr>${cells}</tr></table>${after}`).rows[0];

it('reads type defaults for cells with no attributes and distinguishes header and data selectors', () => {
  const [header, plain, changed] = parse('td, th { font-family:Georgia; font-size:15pt; color:black; font-weight:400 } th { color:#123456 } .other {font-size:9pt}', '<th>Heading</th><td>Plain</td><td class=other>Changed</td>');
  expect(header.style).toEqual({ font: 'georgia', size: 20, color: '#123456', bold: false });
  expect(plain.style).toEqual({ font: 'georgia', size: 20, color: '#000000', bold: false });
  expect(changed.style).toMatchObject({ size: 12, font: 'georgia' });
});

it.each(['early late', 'late early'])('resolves classes by stylesheet order, not attribute order: %s', classes => {
  const [cell] = parse('.early {color:red} .late {color:blue} td {color:green}', `<td class="${classes}">Value</td>`);
  expect(cell.style.color).toBe('#0000ff');
});

it('applies compound, type-qualified and ID specificity without matching another element type', () => {
  const rows = parse('* {color:red} .a.b {color:green} td.a.b {color:blue} #chosen {color:purple} th.a {font-weight:bold}', '<td class="a b">A</td><td class="b a" id=chosen>B</td>');
  expect(rows.map(c => c.style.color)).toEqual(['#0000ff', '#800080']);
  expect(rows[0].style.bold).toBeUndefined();
});

it('honors important declarations, inline specificity, repeated declarations and separate style elements', () => {
  const [a, b, c] = parse('.a {color:blue !important;color:red} #chosen {color:green} td {font-style:italic}',
    '<td class=a id=chosen style="color:purple">A</td><td class=a style="color:purple !important">B</td><td style="color:green;color:blue">C</td>');
  expect([a.style.color, b.style.color, c.style.color]).toEqual(['#0000ff', '#800080', '#0000ff']);
  const result = parseHtmlClipboard('<style>.x{color:red}</style><style>.x{color:blue}</style><table><tr><td class=x>X</td></tr></table>');
  expect(result.rows[0][0].style.color).toBe('#0000ff');
});

it('inherits text properties through ancestors without inheriting their fill or border', () => {
  const rows = parse('body {font-family:Georgia;color:#123456} table {font-size:18pt;background:yellow;border:1px solid red} tr {font-weight:bold} td.reset {color:initial;font-family:inherit;font-weight:unset}', '<td>A</td><td class=reset>B</td>');
  expect(rows[0].style).toEqual({ font: 'georgia', size: 24, color: '#123456', bold: true });
  expect(rows[1].style).toEqual({ font: 'georgia', size: 24, bold: true });
});

it('ignores Office display-only colors while preserving nested character colors', () => {
  const [cell, plain] = parse('', '<td style="color:#123456"><font color="red" style="mso-ignore: COLOR"><b>A</b><font color="blue">B</font>C</font></td><td><font color="red" style="mso-ignore:color">D</font></td>');
  expect(cell.style.color).toBe('#123456');
  expect(cell.richText.map(run => [run.text, run.s.color, run.s.bold])).toEqual([
    ['A', '#123456', true], ['B', '#0000ff', undefined], ['C', '#123456', undefined],
  ]);
  expect(plain.style?.color).toBeUndefined();
  expect(plain.richText).toBeUndefined();
});

it('keeps important shorthand/longhand order when reading borders and decorations', () => {
  const [cell] = parse('td {border:1px solid red !important;text-decoration:none} .line {border-top:3px solid blue;text-decoration-line:underline}', '<td class=line>Value</td>');
  expect(cell.style.btBorder).toEqual({ bs: 'thin', bc: '#ff0000' });
  expect(cell.style).toMatchObject({ underline: true, strike: false });
});

it('reads comments and quoted punctuation safely without applying print-only rules or injecting styles', () => {
  const count = document.querySelectorAll('style').length;
  const [cell] = parse('<!-- @page { margin:0 } @media print {td {color:red}} /* comment */ td {font-family:"Family; { /*literal*/ }";color:blue} -->', '<td>X</td>');
  expect(cell.style).toEqual({ font: 'font:Family; { /*literal*/ }', color: '#0000ff' });
  expect(document.querySelectorAll('style').length).toBe(count);
});

it('handles deep inheritance without recursive traversal', () => {
  const [cell] = parse('', '<td>X</td>', '<div style="font-family:Georgia">' + '<div>'.repeat(3000), '</div>'.repeat(3001));
  expect(cell.style.font).toBe('georgia');
});

it.each([['Georgia', 'georgia'], ['Geneva', 'font:Geneva']])('preserves default stylesheet font %s through paste, external HTML copy and native XLSX without metadata', async (family, font) => {
  const row = parse(`td {font-family:${family};font-size:10pt;font-weight:400;color:black}`, '<td>Data</td>');
  const cell = cellsFromHtmlRows([row])[0].cell;
  const wb = new Workbook({ normalFont: { name: 'Arial', sz: 16, bold: true, color: '#ff0000' } }), id = wb.activeSheetId;
  wb.pasteCells(id, [[cell]], 0, 0);
  expect(wb.styleAt(id, 0, 0)).toMatchObject({ font, bold: false, color: '#000000' });
  const copied = cellsToHtml([['Data']], wb.copyRange(id, { r1: 0, c1: 0, r2: 0, c2: 0 })).replace(/ data-spreadsheet-[\w-]+="[^"]*"/g, '');
  expect(parseHtmlClipboard(copied).rows[0][0].style).toMatchObject({ font, bold: false, color: '#000000' });
  const blob = await workbookToXlsx(wb);
  const data = await new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsArrayBuffer(blob); });
  const zip = X.CFB.read(new Uint8Array(data), { type: 'array' });
  const part = X.CFB.find(zip, '/xl/workbook.xml');
  part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, '')); part.size = part.content.length;
  const back = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'native.xlsx');
  expect(back.styleAt(back.activeSheetId, 0, 0)).toMatchObject({ font, bold: false, color: '#000000' });
  expect(back.styleAt(back.activeSheetId, 0, 0).size).toBeCloseTo(40 / 3, 12);
});
