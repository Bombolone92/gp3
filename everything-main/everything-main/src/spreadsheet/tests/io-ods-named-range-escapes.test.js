import { expect, it } from 'vitest';
import * as XLSX from '../src/vendor/xlsx.mjs';
import { workbookFromFile } from '../src/core/io.js';
import { quoteSheet } from '../src/core/refs.js';

const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

it.each(['fods', 'ods'].flatMap((format) => [
  'A & B', "Plan's data", 'A "B"', 'x < y', 'x > y', 'literal &amp;', '😀',
].map((name) => ({ format, name }))))(
  'imports escaped named-range attributes for $name in $format', async ({ format, name }) => {
    const ref = `${quoteSheet(name)}!A1:A2`;
    const root = format === 'fods' ? 'document' : 'document-content';
    const content = new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8"?>
      <office:${root} xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
        xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"
        office:mimetype="application/vnd.oasis.opendocument.spreadsheet" office:version="1.2">
        <office:body><office:spreadsheet><table:table table:name="${escape(name)}">
          <table:table-row><table:table-cell office:value-type="float" office:value="42"/></table:table-row>
          <table:table-row><table:table-cell office:value-type="float" office:value="8"/></table:table-row>
        </table:table><table:named-expressions>
          <table:named-range table:name="&#65;mount" table:cell-range-address="${escape(`$${quoteSheet(name)}.A1:.A2`)}"
            table:base-cell-address="${escape(`$${quoteSheet(name)}.$A$1`)}"/>
        </table:named-expressions></office:spreadsheet></office:body>
      </office:${root}>`);
    let bytes = content;
    if (format === 'ods') {
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([[0]]), 'Data');
      const zip = XLSX.CFB.read(new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'ods' })), { type: 'array' });
      XLSX.CFB.utils.cfb_add(zip, 'content.xml', content);
      bytes = XLSX.CFB.write(zip, { type: 'array', fileType: 'zip' });
    }
    const raw = XLSX.read(bytes, { type: 'array' });
    expect(raw.Workbook.Names).toEqual([{ Name: 'Amount', Ref: ref }]);
    const wb = await workbookFromFile(bytes, `names.${format}`);
    expect(wb.names).toEqual([{ name: 'Amount', ref }]);
    wb.setInput(wb.activeSheetId, 0, 1, '=SUM(Amount)');
    expect(wb.getValue(wb.activeSheetId, 0, 1)).toBe(50);
  },
);
