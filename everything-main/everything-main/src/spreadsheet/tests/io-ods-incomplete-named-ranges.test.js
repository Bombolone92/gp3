import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { workbookFromFile, workbookToOds } from '../src/core/io.js';

function fixture(format, local, paired) {
  const definitions = `<table:named-expressions>
    <table:named-range table:name="Amount"/>
    <table:named-range table:name="Amount" table:cell-range-address=""/>
    <table:named-range table:name="Amount" table:cell-range-address=" &#32; "/>
    <table:named-range table:cell-range-address="$Data.$A$1"/>
    <table:named-range table:name="" table:cell-range-address="$Data.$A$1"/>
    <table:named-range table:name="&#65;mount" table:cell-range-address="$Data.$A$1" table:base-cell-address="$Data.$A$1"${paired ? '></table:named-range>' : '/>'}
  </table:named-expressions>`;
  const root = format === 'fods' ? 'document' : 'document-content';
  let bytes = new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8"?>
    <office:${root} xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
      xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"
      office:mimetype="application/vnd.oasis.opendocument.spreadsheet" office:version="1.2">
      <office:body><office:spreadsheet><table:table table:name="Data">
        <table:table-row><table:table-cell office:value-type="float" office:value="42"/>
        <table:table-cell office:value-type="float" office:value="17"/></table:table-row>
        ${local ? definitions : ''}
      </table:table>${local ? '' : definitions}</office:spreadsheet></office:body>
    </office:${root}>`);
  if (format === 'ods') {
    const book = X.utils.book_new(); X.utils.book_append_sheet(book, X.utils.aoa_to_sheet([[0]]), 'Data');
    const zip = X.CFB.read(new Uint8Array(X.write(book, { bookType: 'ods', type: 'array' })), { type: 'array' });
    X.CFB.utils.cfb_add(zip, 'content.xml', bytes);
    bytes = X.CFB.write(zip, { fileType: 'zip', type: 'array' });
  }
  return bytes;
}

it.each(['fods', 'ods'].flatMap((format) => [false, true].flatMap((local) => [false, true].map((paired) => ({ format, local, paired }))))) (
  'ignores incomplete ranges without hiding valid names in $format (local=$local, paired=$paired)', async ({ format, local, paired }) => {
    const bytes = fixture(format, local, paired);
    const raw = X.read(bytes, { type: 'array' });
    expect(raw.Workbook.Names).toEqual([{ Name: 'Amount', Ref: 'Data!$A$1', ...(local ? { Sheet: 0 } : {}) }]);
    const wb = await workbookFromFile(bytes, `incomplete.${format}`), id = wb.sheets[0].id;
    expect(wb.names).toEqual([{ name: 'Amount', ref: 'Data!$A$1', ...(local ? { sheet: 'Data' } : {}) }]);
    expect(wb.getValue(id, 0, 0)).toBe(42); expect(wb.getValue(id, 0, 1)).toBe(17);
    wb.setInput(id, 1, 0, '=Amount'); expect(wb.getValue(id, 1, 0)).toBe(42);
    wb.setInput(id, 0, 0, '84'); expect(wb.getValue(id, 1, 0)).toBe(84);
    wb.undo(); expect(wb.getValue(id, 1, 0)).toBe(42);
    const copy = await workbookFromFile(await workbookToOds(wb), 'clean.ods');
    expect(copy.names).toEqual([{ name: 'Amount', ref: 'Data!$A$1', ...(local ? { sheet: 'Data' } : {}) }]);
    expect(copy.getValue(copy.sheets[0].id, 1, 0)).toBe(42);
  },
);
