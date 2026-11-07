import { expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import * as XLSX from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToOds } from '../src/core/io.js';
import { quoteSheet } from '../src/core/refs.js';

const parser = new (new JSDOM('').window.DOMParser)();
const tableNS = 'urn:oasis:names:tc:opendocument:xmlns:table:1.0';

it.each(['A & B', "Plan's data", 'A "B"', 'x < y', 'x > y', 'literal &amp;', '_x0041_'])(
  'writes valid XML and preserves named references to %s', async (name) => {
    let wb = new Workbook();
    wb.renameSheet(wb.activeSheetId, name);
    wb.setInput(wb.activeSheetId, 0, 0, '42');
    const ref = `${quoteSheet(name)}!$A$1`;
    expect(wb.defineName('Amount', ref)).toBe(null);
    wb.setInput(wb.activeSheetId, 0, 1, '=SUM(Amount)');
    for (let round = 0; round < 2; round++) {
      const bytes = new Uint8Array(await (await workbookToOds(wb)).arrayBuffer());
      const zip = XLSX.CFB.read(bytes, { type: 'array' });
      const content = new TextDecoder().decode(XLSX.CFB.find(zip, 'content.xml').content);
      const doc = parser.parseFromString(content, 'application/xml');
      expect(doc.querySelector('parsererror')?.textContent).toBeUndefined();
      const names = doc.getElementsByTagNameNS(tableNS, 'named-range');
      expect(names.length).toBe(1);
      expect(names[0].getAttributeNS(tableNS, 'name')).toBe('Amount');
      expect(names[0].getAttributeNS(tableNS, 'cell-range-address')).toBe(`$${quoteSheet(name)}.$A$1`);
      expect(names[0].getAttributeNS(tableNS, 'base-cell-address')).toBe(`$${quoteSheet(name)}.$A$1`);
      wb = await workbookFromFile(bytes, 'names.ods');
      expect(wb.names).toEqual([{ name: 'Amount', ref }]);
      expect(wb.getValue(wb.activeSheetId, 0, 0)).toBe(42);
      expect(wb.getValue(wb.activeSheetId, 0, 1)).toBe(42);
    }
  },
);
