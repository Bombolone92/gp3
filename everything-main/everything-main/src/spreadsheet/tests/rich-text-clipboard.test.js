// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { cellsToHtml, parseHtmlClipboard, cellsFromHtmlRows } from '../src/core/clipboard.js';
import { Workbook } from '../src/core/workbook.js';
import boundaries from './fixtures/reference-numeric-text-boundaries.json';

const read = html => { const parsed = parseHtmlClipboard(html); return cellsFromHtmlRows(parsed.rows)[0].cell; };
const foreign = html => html.replace(/ data-spreadsheet-[\w-]+="[^"]*"/g, '');

// Saved desktop Excel controls distinguish bare x:str (typed rich markup)
// from x:str="" (empty) and x:str="value" (one font for the explicit value).
it('writes typed rich markup without replacing its runs with an explicit Office value', () => {
  const values = ['0042', '1.0', 'TRUE', '#N/A', '=1+2', '@SUM(A1)', '+1', '-2', '12%', '$5',
    '  a  b  ', 'a\nb', '😀é', '雪 & "quoted" <value>', ...boundaries.map(x => x.text)];
  for (const v of values) {
    const [first, ...rest] = [...v];
    const cell = { v, s: { font: 'arial', size: 16, wrap: true }, richText: [
      { text: first, s: { bold: true, color: '#663399' } },
      { text: rest.join(''), s: { bold: false, italic: true, color: '#224488' } },
    ] };
    const html = cellsToHtml([[v]], [[cell]], null, [[v]]);
    expect(parseHtmlClipboard(html).cells).toEqual([[cell]]);
    const external = foreign(html);
    if (!/[\u0000-\u0009\u000b-\u001f]/.test(v)) {
      expect(external, v).toMatch(/<td\b[^>]* x:str(?:\s|>)/);
      expect(external, v).not.toContain(' x:str=');
    }
    const back = read(external);
    expect(back.v, v).toBe(v);
    if (!/[\u0000-\u0009\u000b-\u001f]/.test(v)) {
      const chars = (back.richText || [{ text: back.v }]).flatMap(run => [...run.text].map(text => [text, !!(run.s?.bold ?? back.s?.bold), !!(run.s?.italic ?? back.s?.italic)]));
      expect(chars, v).toEqual([...v].map((text, i) => [text, i === 0, i !== 0]));
    }
  }
});

it('preserves character formatting on explicit rich line-break parts', () => {
  const v = 'A\nB', cell = { v, richText: [{ text: 'A', s: { bold: true } }, { text: '\nB', s: { italic: true } }] };
  const html = foreign(cellsToHtml([[v]], [[cell]], null, [[v]]));
  const doc = new DOMParser().parseFromString(html, 'text/html');
  expect(doc.querySelector('br').closest('i')).not.toBeNull();
  expect(read(html).richText.map(r => [r.text, !!r.s?.bold, !!r.s?.italic])).toEqual([['A', true, false], ['\nB', false, true]]);
});

it('retains the originating font of collapsed spaces across inline boundaries', () => {
  for (const [html, bold, italic] of [
    ['<b>A </b><i>B</i>', true, false],
    ['<b>A</b><i> B</i>', false, true],
    ['<b>A </b><i> B</i>', true, false],
    ['<b>A</b><i> </i><u> B</u>', false, true],
  ]) {
    const cell = read(`<table><tr><td>${html}</td></tr></table>`);
    const chars = cell.richText.flatMap(run => [...run.text].map(text => [text, !!run.s?.bold, !!run.s?.italic]));
    expect(cell.v).toBe('A B');
    expect(chars[1], html).toEqual([' ', bold, italic]);
  }
});

it('keeps exact explicit values when rich markup cannot spell the stored text', () => {
  for (const [v, code] of [['a\tb', null], ['a\rb', null], ['a\fb', null], ['12', '0;0;0;"label "@'], ['12', '0;0;0;@@'], ['12', '0;0;0;_(@']]) {
    const cell = { v, s: code ? { fmt: 'custom', code } : {}, richText: [{ text: v.slice(0, 1), s: { bold: true } }, { text: v.slice(1), s: { bold: false } }] };
    const html = foreign(cellsToHtml([[v]], [[cell]], null, [[v]]));
    const doc = new DOMParser().parseFromString(html, 'text/html');
    expect(doc.querySelector('td').getAttribute('x:str')).toBe(v);
    expect(read(html).v).toBe(v);
  }
});

it('keeps partial inline formatting on its own text and respects explicit resets', () => {
  const cell = read('<table><tr><td><b>Bold <i>both</i></b> regular <span style="font-weight:normal;color:#123456">color</span></td></tr></table>');
  expect(cell.v).toBe('Bold both regular color');
  const chars = cell.richText.flatMap(run => [...run.text].map(text => [text, { ...cell.s, ...run.s }]));
  expect(chars.slice(0, 4).every(([, s]) => s.bold)).toBe(true);
  expect(chars.slice(5, 9).every(([, s]) => s.bold && s.italic)).toBe(true);
  expect(chars.slice(10, 17).every(([, s]) => !s.bold && !s.italic)).toBe(true);
  expect(chars.at(-1)[1]).toMatchObject({ bold: false, color: '#123456' });
});

it('retains ordinary uniform inline markup as a cell font', () => {
  const cell = read('<table><tr><td><b><u><i>all</i></u></b></td></tr></table>');
  expect(cell.s).toMatchObject({ bold: true, italic: true, underline: true });
  expect(cell.richText).toBeUndefined();
});

it('round-trips mixed runs through standard HTML without the private cell payload', () => {
  const cell = { v: 'AA  bb\ncc', s: { underline: true, wrap: false }, richText: [
    { text: 'AA ', s: { bold: true, size: 24 } },
    { text: ' bb\ncc', s: { bold: false, underline: false, size: 12, color: '#123456' } },
  ] };
  const html = cellsToHtml([[cell.v]], [[cell]], null, [[cell.v]]).replace(/ data-spreadsheet-[\w-]+="[^"]*"/g, '');
  const back = read(html);
  expect(back.v).toBe(cell.v);
  expect(back.richText.map(run => [run.text, run.s.bold, run.s.size, run.s.underline])).toEqual([
    ['AA ', true, 24, true], [' bb\ncc', false, 12, false],
  ]);
  const parsed = parseHtmlClipboard(html);
  expect(cellsFromHtmlRows(parsed.rows, null, { values: true })[0].cell.richText).toBeUndefined();
});

it('Clear formats removes character formatting and Undo restores it', () => {
  const wb = new Workbook({ sheets: [{ cells: { '0,0': { v: 'ab', richText: [{ text: 'a', s: { bold: true } }, { text: 'b' }] } } }] });
  wb.clearRange(wb.activeSheetId, { r1: 0, c1: 0, r2: 0, c2: 0 }, { contents: false, styles: true });
  expect(wb.getCell(wb.activeSheetId, 0, 0).richText).toBeUndefined();
  expect(wb.getValue(wb.activeSheetId, 0, 0)).toBe('ab');
  wb.undo(); expect(wb.getCell(wb.activeSheetId, 0, 0).richText[0].s.bold).toBe(true);
});

it('keeps superscript, subscript and double underline as character formatting in standard HTML', () => {
  const cell = read('<table><tr><td style="vertical-align:top;font-size:15pt">Base<sup><b>Up</b></sup><sub>Down</sub><span style="text-decoration:underline double"><i>Double</i></span></td></tr></table>');
  expect(cell.s).toMatchObject({ valign: 'top', size: 20 });
  expect(cell.richText.map(run => [run.text, run.s?.vertAlign, run.s?.underline])).toEqual([
    ['Base', undefined, undefined], ['Up', 'superscript', undefined], ['Down', 'subscript', undefined], ['Double', undefined, 'double'],
  ]);
  const html = cellsToHtml([[cell.v]], [[cell]], null, [[cell.v]]).replace(/ data-spreadsheet-[\w-]+="[^"]*"/g, '');
  const doc = new DOMParser().parseFromString(html, 'text/html');
  expect(doc.querySelector('td').style.verticalAlign).toBe('top');
  expect([...doc.querySelectorAll('td > span')].map(span => span.style.verticalAlign)).toEqual(['', 'super', 'sub', '']);
  const back = read(html);
  expect(back.richText.map(run => [run.text, run.s?.vertAlign, run.s?.underline])).toEqual([
    ['Base', undefined, false], ['Up', 'superscript', false], ['Down', 'subscript', false], ['Double', undefined, 'double'],
  ]);
});

it('does not promote uniform character-only formats into unsupported cell styles', () => {
  const cell = read('<table><tr><td><sup style="text-decoration:underline double">All</sup></td></tr></table>');
  expect(cell.s?.vertAlign).toBeUndefined();
  expect(cell.s?.underline).toBeUndefined();
  expect(cell.richText).toEqual([{ text: 'All', s: { underline: 'double', vertAlign: 'superscript' } }]);
});

it('writes semantic character formats inside a neutral cell font for Excel HTML paste', () => {
  const cell = { v: 'Bold plain italic', s: { bold: true, italic: true }, richText: [
    { text: 'Bold', s: { bold: true, italic: false } },
    { text: ' plain', s: { bold: false, italic: false } },
    { text: ' italic', s: { bold: false, italic: true } },
  ] };
  const html = cellsToHtml([[cell.v]], [[cell]]).replace(/ data-spreadsheet-[\w-]+="[^"]*"/g, '');
  const doc = new DOMParser().parseFromString(html, 'text/html');
  expect(doc.querySelector('td').style.fontWeight).toBe('normal');
  expect(doc.querySelector('td').style.fontStyle).toBe('normal');
  expect(doc.querySelector('b').textContent).toBe('Bold');
  expect(doc.querySelector('i').textContent).toBe('\u00a0italic');
  const back = read(html);
  expect(back.richText.map(run => [run.text, run.s.bold, run.s.italic])).toEqual([
    ['Bold', true, false], [' plain', false, false], [' italic', false, true],
  ]);
});

it('carries rich hyperlinks through standard HTML and keeps typed number labels numeric', () => {
  const linked = { v: 'Bold plain', hyperlink: 'https://example.com/details', richText: [{ text: 'Bold', s: { bold: true } }, { text: ' plain', s: { bold: false } }] };
  const html = cellsToHtml([[linked.v]], [[linked]], null, [[linked.v]]).replace(/ data-spreadsheet-[\w-]+="[^"]*"/g, '');
  const parsed = parseHtmlClipboard(html), cell = cellsFromHtmlRows(parsed.rows)[0].cell;
  expect(cell).toMatchObject({ v: linked.v, f: null, hyperlink: linked.hyperlink });
  expect(cell.richText.map(run => [run.text, run.s.bold])).toEqual([['Bold', true], [' plain', false]]);
  const number = cellsFromHtmlRows([[{ text: '$123.00', value: 123, style: { fmt: 'currency' }, link: linked.hyperlink }]])[0].cell;
  expect(number).toMatchObject({ v: 123, f: null, hyperlink: linked.hyperlink });
});
