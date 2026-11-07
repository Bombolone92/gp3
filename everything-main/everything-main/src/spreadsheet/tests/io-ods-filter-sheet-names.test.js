import { expect, it } from 'vitest';
import * as XLSX from '../src/vendor/xlsx.mjs';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';

const escape = (s) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&apos;');

it.each(['fods', 'ods'].flatMap((format) => [
  'Data', 'Source Data', "Plan's.data", 'A & B', 'A"B', 'Q1.2026', 'literal &amp;', '_x0041_', '__proto__', 'constructor', '😀',
].map((name) => ({ format, name }))))(
  'imports filters targeting the quoted sheet $name from $format', async ({ format, name }) => {
    const root = format === 'fods' ? 'document' : 'document-content';
    const address = `$'${name.replaceAll("'", "''")}'.$A$1:.$B$2`;
    const content = new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8"?>
      <office:${root} xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
        xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"
        office:mimetype="application/vnd.oasis.opendocument.spreadsheet" office:version="1.2">
        <office:body><office:spreadsheet><table:table table:name="${escape(name)}">
          <table:table-row><table:table-cell office:value-type="float" office:value="42"/></table:table-row>
        </table:table><table:database-ranges><table:database-range table:name="Filter"
          table:target-range-address="${escape(address)}" table:display-filter-buttons="true"/>
        </table:database-ranges></office:spreadsheet></office:body>
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
    expect(raw.Sheets[name]['!autofilter']).toEqual({ ref: '$A$1:$B$2' });
    let wb = await workbookFromFile(bytes, `filters.${format}`);
    for (let round = 0; round < 2; round++) {
      expect(wb.sheets[0].name).toBe(name);
      expect(wb.sheets[0].filter).toEqual({ range: { r1: 0, c1: 0, r2: 1, c2: 1 }, criteria: {} });
      expect(wb.getValue(wb.activeSheetId, 0, 0)).toBe(42);
      if (!round) wb = await workbookFromFile(await workbookToXlsx(wb), 'filters.xlsx');
    }
  },
);
