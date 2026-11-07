import { expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import * as XLSX from '../src/vendor/xlsx.mjs';
import { workbookFromFile } from '../src/core/io.js';
import { quoteSheet } from '../src/core/refs.js';

const parser = new (new JSDOM('').window.DOMParser)();
const tableNS = 'urn:oasis:names:tc:opendocument:xmlns:table:1.0';

it.each(['Data', 'A1', 'Q1.2026', 'Spend!Now', "Plan's.data!", "V1.2!O'Brien"].flatMap((name) =>
  ['$A$1', '$A$1:$A$2'].map((cells) => ({ name, cells }))))(
  'exports references to $name $cells without changing the sheet name', async ({ name, cells }) => {
    const inputRef = `${quoteSheet(name)}!${cells}`;
    const sheet = name.includes('.') ? `'${name.replaceAll("'", "''")}'` : quoteSheet(name);
    const ref = `${sheet}!${cells}`, odsref = `${sheet}.${cells.replace(':', ':.')}`;
    let book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, { '!ref': 'A1', A1: { t: 's', v: 'Jump', l: { Target: `#${inputRef}` } } }, 'Index');
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([[42], [8]]), name);
    book.Workbook = { Names: [{ Name: 'Amount', Ref: inputRef }] };
    for (let round = 0; round < 2; round++) {
      const bytes = new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'ods' }));
      const zip = XLSX.CFB.read(bytes, { type: 'array' });
      const doc = parser.parseFromString(new TextDecoder().decode(XLSX.CFB.find(zip, 'content.xml').content), 'application/xml');
      expect(doc.querySelector('parsererror')?.textContent).toBeUndefined();
      const defined = doc.getElementsByTagNameNS(tableNS, 'named-range')[0];
      expect(defined.getAttributeNS(tableNS, 'cell-range-address')).toBe(`$${odsref}`);
      const link = doc.getElementsByTagNameNS('urn:oasis:names:tc:opendocument:xmlns:text:1.0', 'a')[0];
      expect(link.getAttributeNS('http://www.w3.org/1999/xlink', 'href')).toBe(`#${odsref}`);
      book = XLSX.read(bytes, { type: 'array' });
      expect(book.Workbook.Names).toEqual([{ Name: 'Amount', Ref: ref }]);
      expect(book.Sheets.Index.A1.l.Target).toBe(`#${ref}`);
      const wb = await workbookFromFile(bytes, 'references.ods');
      wb.setInput(wb.activeSheetId, 0, 1, '=SUM(Amount)');
      expect(wb.getValue(wb.activeSheetId, 0, 1)).toBe(cells.includes(':') ? 50 : 42);
      expect(wb.resolveLink(wb.linkAt(wb.activeSheetId, 0, 0).url)).toMatchObject({
        sheetId: wb.sheetByName(name).id, range: { r1: 0, c1: 0, r2: cells.includes(':') ? 1 : 0, c2: 0 },
      });
    }
  },
);
