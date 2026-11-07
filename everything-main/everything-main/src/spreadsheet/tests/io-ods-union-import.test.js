import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { workbookFromFile, workbookToOds } from '../src/core/io.js';

const escape = (s) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
function fixture(formula, format, expression = null) {
  const root = format === 'ods' ? 'document-content' : 'document';
  const names = expression ? `<table:named-expressions><table:named-expression table:name="Combined" table:expression="${escape('of:=' + expression)}" table:base-cell-address="$Data.$A$1"/></table:named-expressions>` : '';
  let bytes = new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8"?>
    <office:${root} xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" office:mimetype="application/vnd.oasis.opendocument.spreadsheet">
      <office:body><office:spreadsheet><table:table table:name="Data">
        <table:table-row>${[10, 20, 30].map((v) => `<table:table-cell office:value-type="float" office:value="${v}"/>`).join('')}</table:table-row>
        <table:table-row><table:table-cell office:value-type="float" office:value="40"/></table:table-row>
        <table:table-row><table:table-cell table:number-columns-repeated="3"/><table:table-cell office:value-type="float" office:value="0" table:formula="${escape('of:=' + formula)}"/></table:table-row>
      </table:table>${names}</office:spreadsheet></office:body>
    </office:${root}>`);
  if (format === 'ods') {
    const book = X.utils.book_new(); X.utils.book_append_sheet(book, X.utils.aoa_to_sheet([[0]]), 'Data');
    const zip = X.CFB.read(new Uint8Array(X.write(book, { bookType: 'ods', type: 'array' })), { type: 'array' });
    X.CFB.utils.cfb_add(zip, 'content.xml', bytes); bytes = X.CFB.write(zip, { type: 'array', fileType: 'zip' });
  }
  return bytes;
}
const cases = [
  ['AREAS([.A1]~[.B1])', 'AREAS((A1,B1))', 2],
  ['INDEX([.A1]~[.B1];1;1;2)', 'INDEX((A1,B1),1,1,2)', 20],
  ['AREAS([.A1]~[.B1]~[.C1])', 'AREAS((A1,B1,C1))', 3],
  ['AREAS(([.A1]~[.B1]))', 'AREAS((A1,B1))', 2],
  ['AREAS(([.A1]~[.B1])~[.C1])', 'AREAS(((A1,B1),C1))', 3],
  ['SUM([.A1]:[.A2]~[.B1])', 'SUM((A1:A2,B1))', 70],
  ['SUM(IF(TRUE;[.A1];[.B1])~[.C1])', 'SUM((IF(TRUE,A1,B1),C1))', 40],
  ['SUM([.A1]~[.B1]^2)', 'SUM((A1,B1)^2)', 500],
  ['SUM(-[.A1]~[.B1])', 'SUM(-(A1,B1))', -30],
  ['SUM([.A1]~[.B1]+1)', 'SUM((A1,B1)+1)', 32],
  ['SUM([.A1]~[.B1];[.C1])', 'SUM((A1,B1),C1)', 60],
  ['IF("a~b"="a~b";AREAS([.A1]~[.B1]);0)', 'IF("a~b"="a~b",AREAS((A1,B1)),0)', 2],
  ['LET(f;LAMBDA(x;y;SUM(x~y));f([.A1];[.B1]))', 'LET(f,LAMBDA(x,y,SUM((x,y))),f(A1,B1))', 30],
  ['SUM(LAMBDA([.A1])()~[.B1])', 'SUM((LAMBDA(A1)(),B1))', 30],
  ['SUM({1;2|3;4})+AREAS([.A1]~[.B1])', 'SUM({1,2;3,4})+AREAS((A1,B1))', 12],
  ['IF("(~;"="(~;";2;0)', 'IF("(~;"="(~;",2,0)', 2],
  ['IFERROR(SUM([.A1]~#REF!);7)', 'IFERROR(SUM((A1,#REF!)),7)', 7],
  ['IFERROR(SUM([.A1]~#N/A);7)', 'IFERROR(SUM((A1,#N/A)),7)', 7],
];
it.each(['ods', 'fods'].flatMap((format) => cases.map(([formula, expected, value]) => ({ format, formula, expected, value }))))(
  'retains union grouping when importing $formula from $format', async ({ format, formula, expected, value }) => {
    const bytes = fixture(formula, format);
    expect(X.read(bytes, { type: 'array' }).Sheets.Data.D3.f).toBe(expected);
    let wb = await workbookFromFile(bytes, `union.${format}`);
    expect(wb.getValue(wb.sheets[0].id, 2, 3)).toBe(value);
    for (let i = 0; i < 2; i++) {
      wb = await workbookFromFile(await workbookToOds(wb), 'resaved.ods');
      expect(wb.getCell(wb.sheets[0].id, 2, 3).f).toBe(expected);
      expect(wb.getValue(wb.sheets[0].id, 2, 3)).toBe(value);
    }
  },
);

it.each(['ods', 'fods'])('preserves a top-level union in a named expression imported from %s', async (format) => {
  const bytes = fixture('INDEX(Combined;1;1;2)', format, '[$Data.A1]~[$Data.B1]');
  const wb = await workbookFromFile(bytes, `named.${format}`), id = wb.sheets[0].id;
  expect(wb.names[0].ref).toBe('(Data!A1,Data!B1)');
  expect(wb.getValue(id, 2, 3)).toBe(20);
  wb.setInput(id, 0, 1, '50'); expect(wb.getValue(id, 2, 3)).toBe(50);
  wb.undo(); expect(wb.getValue(id, 2, 3)).toBe(20);
});
