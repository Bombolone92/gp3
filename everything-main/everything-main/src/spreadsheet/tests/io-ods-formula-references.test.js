import { expect, it } from 'vitest';
import * as XLSX from '../src/vendor/xlsx.mjs';
import { workbookFromFile } from '../src/core/io.js';

const escape = (s) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const quoted = (s) => `'${s.replaceAll("'", "''")}'`;
const names = ['Data', 'Q1.2026', "Plan's.data", 'A"B', 'A;|~COM.MICROSOFT.Data', '$Budget'];
const cases = [
  ['[.A1]+1', 'A1+1', 3], ['[.$A$1]+1', '$A$1+1', 3],
  ['SUM([.A1:.B2])', 'SUM(A1:B2)', 17],
  ['SUM([.A$1:.$B2])', 'SUM(A$1:$B2)', 17],
  ['SUM([.$A:.$B])', 'SUM($A:$B)', 17], ['SUM([.$1:.$2])', 'SUM($1:$2)', 17],
  ['IFERROR([#REF!];"missing")', 'IFERROR(#REF!,"missing")', 'missing'],
  ['IFERROR([.#VALUE!];"missing")', 'IFERROR(#VALUE!,"missing")', 'missing'],
  ["'Data'![.A1]+1", "'Data'!A1+1", 3],
  ...names.map((name) => [`SUM([$${quoted(name)}.$A$1:.$B$2])`, `SUM(${quoted(name)}!$A$1:$B$2)`, 17, name]),
  ['SUM([$Data.$A$1:$Data.$B$2])', 'SUM(Data!$A$1:$B$2)', 17],
  ["SUM([$Data.$A$1:$'Data'.$B$2])", 'SUM(Data!$A$1:$B$2)', 17],
  ['SUM([$First.$A$1:$Last.$B$2])', 'SUM(First:Last!$A$1:$B$2)', 51],
];

it.each(['fods', 'ods'].flatMap((format) => cases.map(([input, expected, value, name = 'Data']) => ({ format, input, expected, value, name }))))(
  'imports $input from $format as an evaluable formula', async ({ format, input, expected, value, name }) => {
    const root = format === 'fods' ? 'document' : 'document-content';
    const sheetNames = input.includes('$First.') ? ['First', 'Middle', 'Last'] : [name];
    const tables = sheetNames.map((sheet, i) => `<table:table table:name="${escape(sheet)}">
      <table:table-row><table:table-cell office:value-type="float" office:value="2"/><table:table-cell office:value-type="float" office:value="5"/></table:table-row>
      <table:table-row><table:table-cell office:value-type="float" office:value="3"/><table:table-cell office:value-type="float" office:value="7"/></table:table-row>
      ${i ? '' : `<table:table-row><table:table-cell table:number-columns-repeated="2"/>
        <table:table-cell office:value-type="float" table:formula="${escape(`of:=${input}`)}"/></table:table-row>`}
    </table:table>`).join('');
    const content = new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8"?>
      <office:${root} xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
        xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"
        office:mimetype="application/vnd.oasis.opendocument.spreadsheet" office:version="1.2">
        <office:body><office:spreadsheet>${tables}</office:spreadsheet></office:body>
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
    expect(raw.Sheets[sheetNames[0]].C3.f).toBe(expected);
    const wb = await workbookFromFile(bytes, `references.${format}`);
    expect(wb.getCell(wb.activeSheetId, 2, 2).f).toBe(expected);
    expect(wb.getValue(wb.activeSheetId, 2, 2)).toBe(value);
  },
);
