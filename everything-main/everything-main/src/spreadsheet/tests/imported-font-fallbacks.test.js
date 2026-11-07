// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { fontKeyFor, fontName, fontStack } from '../src/core/format.js';
import { cellsToHtml, cellsFromHtmlRows, parseHtmlClipboard } from '../src/core/clipboard.js';

it('keeps Book Antiqua first and uses serif fallbacks without changing the native family', () => {
  for (const name of ['Book Antiqua', 'book antiqua', 'BOOK ANTIQUA']) {
    const key = fontKeyFor(name, { literal: true }), css = fontStack(key);
    expect(css).toBe(`"${name}", Palatino, "Palatino Linotype", Georgia, serif`);
    expect(fontKeyFor(css)).toBe(key);
    expect(fontName(key)).toBe(name);
  }
  expect(fontStack('font:Book Antiqua Extended')).toBe('"Book Antiqua Extended", Arial, sans-serif');
  expect(fontStack('font:Arial Nova Cond')).toContain('"Arial Narrow", "Avenir Next Condensed"');
});

it('preserves the requested font through external HTML in both directions', () => {
  const imported = cellsFromHtmlRows(parseHtmlClipboard('<table><tr><td style="font-family:Book Antiqua;font-weight:bold;font-size:24px">Heading</td></tr></table>').rows)[0].cell;
  expect(imported.s.font).toBe('font:Book Antiqua');
  const html = cellsToHtml([['Heading']], [[imported]], [[imported.s]])
    .replace(/ data-spreadsheet-[\w-]+="[^"]*"/g, '');
  const td = document.createElement('div');
  td.innerHTML = html;
  expect(td.querySelector('td').style.fontFamily).toBe('\"Book Antiqua\"');
  const pasted = cellsFromHtmlRows(parseHtmlClipboard(html).rows)[0].cell;
  expect(pasted.s).toMatchObject({ font: 'font:Book Antiqua', bold: true });
});

it('keeps Sylfaen serif fallbacks out of native font identity and external clipboard data', () => {
  for (const name of ['Sylfaen', 'sylfaen', 'SYLFAEN']) {
    const key = fontKeyFor(name, { literal: true });
    expect(fontStack(key)).toBe(`"${name}", "Times New Roman", Times, serif`);
    expect(fontStack(key, { fallbacks: false })).toBe(`"${name}"`);
    expect(fontKeyFor(fontStack(key))).toBe(key);
    expect(fontName(key)).toBe(name);
  }
  expect(fontStack('font:Sylfaen Custom')).toBe('"Sylfaen Custom", Arial, sans-serif');
  const text = 'Latin Ελληνικά Հայերեն ქართული';
  const cell = cellsFromHtmlRows(parseHtmlClipboard(`<table><tr><td style="font-family:Sylfaen;font-weight:bold">${text}</td></tr></table>`).rows)[0].cell;
  const html = cellsToHtml([[text]], [[cell]], [[cell.s]])
    .replace(/ data-spreadsheet-[\w-]+="[^"]*"/g, '');
  expect(new DOMParser().parseFromString(html, 'text/html').querySelector('td').style.fontFamily).toBe('"Sylfaen"');
  const back = cellsFromHtmlRows(parseHtmlClipboard(html).rows)[0].cell;
  expect(back.v).toBe(text);
  expect(back.s).toMatchObject({ font: 'font:Sylfaen', bold: true });
});

it('uses the bundled Cambria fallback without substituting its native or clipboard family', () => {
  for (const name of ['Cambria', 'cambria', 'CAMBRIA']) {
    const key = fontKeyFor(name, { literal: true });
    expect(fontStack(key)).toBe('Cambria, Caladea, Georgia, "Times New Roman", serif');
    expect(fontName(key)).toBe('Cambria');
  }
  const imported = cellsFromHtmlRows(parseHtmlClipboard('<table><tr><td style="font-family:Cambria;font-weight:bold;font-style:italic">Mixed typography</td></tr></table>').rows)[0].cell;
  const html = cellsToHtml([['Mixed typography']], [[imported]], [[imported.s]])
    .replace(/ data-spreadsheet-[\w-]+="[^"]*"/g, '');
  expect(new DOMParser().parseFromString(html, 'text/html').querySelector('td').style.fontFamily).toBe('\"Cambria\"');
  expect(cellsFromHtmlRows(parseHtmlClipboard(html).rows)[0].cell.s).toMatchObject({ font: 'cambria', bold: true, italic: true });
});

it('uses a narrower fallback for Aptos Narrow while retaining the imported family', () => {
  for (const name of ['Aptos Narrow', 'aptos narrow', 'APTOS NARROW']) {
    const key = fontKeyFor(name, { literal: true });
    expect(fontStack(key)).toBe(`"${name}", Carlito, "Arial Narrow", Arial, sans-serif`);
    expect(fontName(key)).toBe(name);
    expect(fontKeyFor(fontStack(key))).toBe(key);
  }
  expect(fontStack('font:Aptos')).toBe('"Aptos", Arial, sans-serif');
});

it('uses installed Gill Sans for Gill Sans MT without changing the requested face or condensed variants', () => {
  for (const name of ['Gill Sans MT', 'gill sans mt', 'GILL SANS MT']) {
    const key = fontKeyFor(name, { literal: true });
    expect(fontStack(key)).toBe(`"${name}", "Gill Sans", Arial, sans-serif`);
    expect(fontStack(key, { fallbacks: false })).toBe(`"${name}"`);
    expect(fontKeyFor(fontStack(key))).toBe(key);
    expect(fontName(key)).toBe(name);
  }
  expect(fontStack('font:Gill Sans MT Condensed')).toBe('"Gill Sans MT Condensed", Arial, sans-serif');
  expect(fontStack('font:Gill Sans MT Ext Condensed Bold')).toBe('"Gill Sans MT Ext Condensed Bold", Arial, sans-serif');
});
