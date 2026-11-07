import { expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import * as XLSX from '../src/vendor/xlsx.mjs';
import { quoteSheet } from '../src/core/refs.js';

const parser = new (new JSDOM('').window.DOMParser)();
const tableNS = 'urn:oasis:names:tc:opendocument:xmlns:table:1.0';

it.each(['Data', 'Q1.2026', "Plan's.data"].flatMap((name) => [false, true].flatMap((local) =>
  ['B2', 'B2:C3', '$B$2:$C$3'].map((cells) => ({ name, local, cells })))))(
  'writes a single base-cell address for $name $cells (local=$local)', ({ name, local, cells }) => {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([[1, 2, 3], [4, 5, 6], [7, 8, 9]]), name);
    book.Workbook = { Names: [{ Name: 'Amount', Ref: `${quoteSheet(name)}!${cells}`, ...(local ? { Sheet: 0 } : {}) }] };
    const bytes = new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'ods' }));
    const zip = XLSX.CFB.read(bytes, { type: 'array' });
    const doc = parser.parseFromString(new TextDecoder().decode(XLSX.CFB.find(zip, 'content.xml').content), 'application/xml');
    expect(doc.querySelector('parsererror')?.textContent).toBeUndefined();
    const ranges = doc.getElementsByTagNameNS(tableNS, 'named-range');
    expect(ranges.length).toBe(1);
    const sheet = name.includes('.') ? `'${name.replaceAll("'", "''")}'` : quoteSheet(name);
    const prefix = `${local ? '' : '$'}${sheet}.`;
    expect(ranges[0].getAttributeNS(tableNS, 'base-cell-address')).toBe(`${prefix}$A$1`);
    expect(ranges[0].getAttributeNS(tableNS, 'cell-range-address')).toBe(prefix + cells.replace(':', ':.'));
    expect(ranges[0].parentNode.parentNode.localName).toBe(local ? 'table' : 'spreadsheet');
    const back = XLSX.read(bytes, { type: 'array' });
    expect(back.Workbook.Names).toEqual([{ Name: 'Amount', Ref: `${sheet}!${cells}`, ...(local ? { Sheet: 0 } : {}) }]);
    expect(XLSX.utils.sheet_to_json(back.Sheets[name], { header: 1 })).toEqual([[1, 2, 3], [4, 5, 6], [7, 8, 9]]);
  },
);
