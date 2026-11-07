import { expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import * as XLSX from '../src/vendor/xlsx.mjs';
import { workbookFromFile } from '../src/core/io.js';
import { quoteSheet } from '../src/core/refs.js';

const parser = new (new JSDOM('').window.DOMParser)();
const xlinkNS = 'http://www.w3.org/1999/xlink';
const cases = ['A "B"', 'x < y', 'x > y', 'A & B', "Plan's.data!"].map((name) => ({
  name, target: `#${quoteSheet(name)}!B2`, encodedTarget: `#${quoteSheet(name)}.B2`,
})).concat([
  'https://example.com/?q="a"&x=1', 'https://example.com/?q=<tag>',
  "https://example.com/?q='a'&x=1", 'https://example.com/" xlink:title="Injected',
].map((target) => ({ target, encodedTarget: target })));

it.each(cases)('keeps ODS hyperlink target $target in one XML attribute', async ({ name, target, encodedTarget }) => {
  let book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, { '!ref': 'A1', A1: { t: 's', v: 'Jump', l: { Target: target } } }, 'Index');
  if (name) XLSX.utils.book_append_sheet(book, { '!ref': 'B2', B2: { t: 'n', v: 42 } }, name);
  for (let round = 0; round < 2; round++) {
    const bytes = new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'ods' }));
    const zip = XLSX.CFB.read(bytes, { type: 'array' });
    const doc = parser.parseFromString(new TextDecoder().decode(XLSX.CFB.find(zip, 'content.xml').content), 'application/xml');
    expect(doc.querySelector('parsererror')?.textContent).toBeUndefined();
    const links = doc.getElementsByTagNameNS('urn:oasis:names:tc:opendocument:xmlns:text:1.0', 'a');
    expect(links.length).toBe(1);
    expect(links[0].attributes.length).toBe(1);
    expect(links[0].getAttributeNS(xlinkNS, 'href')).toBe(encodedTarget);
    expect(links[0].textContent).toBe('Jump');
    book = XLSX.read(bytes, { type: 'array' });
    expect(book.Sheets.Index.A1.l.Target).toBe(target);
    const wb = await workbookFromFile(bytes, 'links.ods');
    expect(wb.linkAt(wb.activeSheetId, 0, 0)).toEqual({ url: target, label: 'Jump' });
    if (name) expect(wb.resolveLink(target)).toMatchObject({ sheetId: wb.sheetByName(name).id, range: { r1: 1, c1: 1, r2: 1, c2: 1 } });
  }
});
