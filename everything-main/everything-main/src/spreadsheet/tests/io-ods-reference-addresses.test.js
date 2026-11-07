import { expect, it } from 'vitest';
import * as XLSX from '../src/vendor/xlsx.mjs';
import { workbookFromFile } from '../src/core/io.js';
import { quoteSheet } from '../src/core/refs.js';

const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

it.each(['fods', 'ods'].flatMap((format) => ['Data', 'Q1.2026', "Plan's.data", 'A1', '$Budget', 'Spend!Now'].flatMap((name) => [
  ['$A$1', '$A$1', 42], ['$A$1:.$A$2', '$A$1:$A$2', 50], ['A$1:.$A2', 'A$1:$A2', 50],
].map(([address, cells, total]) => ({ format, name, address, cells, total })))))(
  'preserves $name $address in $format named ranges and internal links', async ({ format, name, address, cells, total }) => {
    const sheet = name.includes('.') ? `'${name.replaceAll("'", "''")}'` : quoteSheet(name);
    const odsref = `$${sheet}.${address}`, ref = `${sheet}!${cells}`;
    const root = format === 'fods' ? 'document' : 'document-content';
    const content = new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8"?>
      <office:${root} xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
        xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"
        xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:xlink="http://www.w3.org/1999/xlink"
        office:mimetype="application/vnd.oasis.opendocument.spreadsheet" office:version="1.2">
        <office:body><office:spreadsheet><table:table table:name="${escape(name)}">
          <table:table-row><table:table-cell office:value-type="float" office:value="42"/>
            <table:table-cell office:value-type="string"><text:p><text:a xlink:href="${escape(`#${odsref}`)}">Jump</text:a></text:p></table:table-cell>
          </table:table-row><table:table-row><table:table-cell office:value-type="float" office:value="8"/></table:table-row>
        </table:table><table:named-expressions>
          <table:named-range table:name="Amount" table:cell-range-address="${escape(odsref)}" table:base-cell-address="${escape(`$${sheet}.$A$1`)}"/>
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
    expect(raw.Sheets[name].B1.l.Target).toBe(`#${ref}`);
    const wb = await workbookFromFile(bytes, `names.${format}`);
    expect(wb.names).toEqual([{ name: 'Amount', ref }]);
    wb.setInput(wb.activeSheetId, 0, 2, '=SUM(Amount)');
    expect(wb.getValue(wb.activeSheetId, 0, 2)).toBe(total);
    const link = wb.linkAt(wb.activeSheetId, 0, 1);
    expect(link).toEqual({ url: `#${ref}`, label: 'Jump' });
    expect(wb.resolveLink(link.url)).toMatchObject({ sheetId: wb.activeSheetId, range: { r1: 0, c1: 0, r2: total === 42 ? 0 : 1, c2: 0 } });
  },
);
