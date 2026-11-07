import { expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import * as X from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToOds } from '../src/core/io.js';

const parser = new (new JSDOM('').window.DOMParser)();
const tableNS = 'urn:oasis:names:tc:opendocument:xmlns:table:1.0';
const escape = (s) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const contentDoc = (bytes) => {
  const zip = X.CFB.read(bytes, { type: 'array' });
  const doc = parser.parseFromString(new TextDecoder().decode(X.CFB.find(zip, 'content.xml').content), 'application/xml');
  expect(doc.querySelector('parsererror')).toBeNull();
  return doc;
};

it.each([
  ['0.2', 'of:=0.2', '100*Result', 20],
  ['TRUE', 'of:=TRUE', 'IF(Result,10,20)', 10],
  ['"A & <B> _x0041_"', 'of:="A & <B> _x0041_"', 'Result', 'A & <B> _x0041_'],
  ['SUM(Sheet1!$A$1:$A$2)*2', 'of:=SUM([$Sheet1.$A$1:.$A$2])*2', 'Result', 100],
  ['IF(Sheet1!A1>10,"yes; a,b","no")', 'of:=IF([$Sheet1.A1]>10;"yes; a,b";"no")', 'Result', 'yes; a,b'],
  ['LAMBDA(x,x*2)', 'of:=LAMBDA(x;x*2)', 'Result(21)', 42],
  ['SUM({1,2;3,4})', 'of:=SUM({1;2|3;4})', 'Result', 10],
])('exports %s as a named expression and preserves calculations over repeated saves', async (ref, expression, formula, expected) => {
  let wb = new Workbook();
  wb.setInput(wb.activeSheetId, 0, 0, '42');
  wb.setInput(wb.activeSheetId, 1, 0, '8');
  expect(wb.defineName('Result', ref)).toBeNull();
  expect(wb.defineName('Source', 'Sheet1!$A$1:$A$2')).toBeNull();
  wb.setInput(wb.activeSheetId, 0, 2, `=${formula}`);
  expect(wb.getValue(wb.activeSheetId, 0, 2)).toBe(expected);
  for (let round = 0; round < 2; round++) {
    const bytes = new Uint8Array(await (await workbookToOds(wb)).arrayBuffer());
    const doc = contentDoc(bytes), expressions = doc.getElementsByTagNameNS(tableNS, 'named-expression');
    expect(expressions.length).toBe(1);
    expect(expressions[0].getAttributeNS(tableNS, 'name')).toBe('Result');
    expect(expressions[0].getAttributeNS(tableNS, 'expression')).toBe(expression);
    expect(expressions[0].getAttributeNS(tableNS, 'base-cell-address')).toBe('$Sheet1.$A$1');
    expect(doc.getElementsByTagNameNS(tableNS, 'named-range').length).toBe(1);
    wb = await workbookFromFile(bytes, 'expressions.ods');
    expect(wb.names.find((n) => n.name === 'Result').ref).toBe(ref);
    expect(wb.getValue(wb.activeSheetId, 0, 2)).toBe(expected);
  }
});

it.each(['fods', 'ods'].flatMap((format) => [false, true].map((local) => ({ format, local }))))(
  'reads hand-written named expressions in $format (local=$local)', async ({ format, local }) => {
    const names = `<table:named-expressions>
      <table:named-expression table:name="&#82;ate" table:expression="of:=0.2" table:base-cell-address="$Data.$A$1"></table:named-expression>
      <table:named-expression table:name="Caption" table:expression="${escape('of:="A & <B> _x0041_"')}" table:base-cell-address="$Data.$A$1"/>
      <table:named-expression table:name="Total" table:expression="${escape('of:=SUM([$Data.$A$1:.$A$2])*Rate')}" table:base-cell-address="$Data.$A$1"/>
    </table:named-expressions>`;
    const root = format === 'fods' ? 'document' : 'document-content';
    const content = new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8"?>
      <office:${root} xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
        xmlns:table="${tableNS}" xmlns:of="urn:oasis:names:tc:opendocument:xmlns:of:1.2"
        office:mimetype="application/vnd.oasis.opendocument.spreadsheet" office:version="1.2">
        <office:body><office:spreadsheet><table:table table:name="Data">
          <table:table-row><table:table-cell office:value-type="float" office:value="42"/></table:table-row>
          <table:table-row><table:table-cell office:value-type="float" office:value="8"/></table:table-row>
          ${local ? names : ''}
        </table:table>${local ? '' : names}</office:spreadsheet></office:body>
      </office:${root}>`);
    let bytes = content;
    if (format === 'ods') {
      const base = X.utils.book_new();
      X.utils.book_append_sheet(base, X.utils.aoa_to_sheet([[0]]), 'Data');
      const zip = X.CFB.read(new Uint8Array(X.write(base, { bookType: 'ods', type: 'array' })), { type: 'array' });
      X.CFB.utils.cfb_add(zip, 'content.xml', content);
      bytes = X.CFB.write(zip, { fileType: 'zip', type: 'array' });
    }
    const expected = [
      { Name: 'Rate', Ref: '0.2' },
      { Name: 'Caption', Ref: '"A & <B> _x0041_"' },
      { Name: 'Total', Ref: 'SUM(Data!$A$1:$A$2)*Rate' },
    ].map((n) => ({ ...n, ...(local ? { Sheet: 0 } : {}) }));
    expect(X.read(bytes, { type: 'array' }).Workbook.Names).toEqual(expected);
    const wb = await workbookFromFile(bytes, `expressions.${format}`);
    wb.setInput(wb.activeSheetId, 0, 1, '=Total');
    expect(wb.getValue(wb.activeSheetId, 0, 1)).toBe(10);
    wb.setInput(wb.activeSheetId, 0, 0, '92');
    expect(wb.getValue(wb.activeSheetId, 0, 1)).toBe(20);
    wb.undo();
    expect(wb.getValue(wb.activeSheetId, 0, 1)).toBe(10);
  },
);

it.each([false, true])('exports scoped expressions with a valid quoted base address (local=%s)', (local) => {
  const book = X.utils.book_new();
  X.utils.book_append_sheet(book, X.utils.aoa_to_sheet([[1]]), "Plan's & data");
  book.Workbook = { Names: [{ Name: 'Rate', Ref: '=0.2', ...(local ? { Sheet: 0 } : {}) }] };
  const bytes = new Uint8Array(X.write(book, { bookType: 'ods', type: 'array' }));
  const node = contentDoc(bytes).getElementsByTagNameNS(tableNS, 'named-expression')[0];
  expect(node.getAttributeNS(tableNS, 'expression')).toBe('of:=0.2');
  expect(node.getAttributeNS(tableNS, 'base-cell-address')).toBe("$'Plan''s & data'.$A$1");
  expect(node.parentNode.parentNode.localName).toBe(local ? 'table' : 'spreadsheet');
  expect(X.read(bytes, { type: 'array' }).Workbook.Names).toEqual([{ Name: 'Rate', Ref: '0.2', ...(local ? { Sheet: 0 } : {}) }]);
});

it('keeps workbook and second-sheet expressions in their own scopes', () => {
  const book = X.utils.book_new();
  X.utils.book_append_sheet(book, X.utils.aoa_to_sheet([[1]]), 'First');
  X.utils.book_append_sheet(book, X.utils.aoa_to_sheet([[2]]), 'Second');
  book.Workbook = { Names: [
    { Name: 'Rate', Ref: '0.2' },
    { Name: 'Rate', Ref: '0.4', Sheet: 1 },
  ] };
  const bytes = new Uint8Array(X.write(book, { bookType: 'ods', type: 'array' }));
  const expressions = [...contentDoc(bytes).getElementsByTagNameNS(tableNS, 'named-expression')];
  expect(expressions.map((node) => [node.getAttributeNS(tableNS, 'expression'), node.getAttributeNS(tableNS, 'base-cell-address')]))
    .toEqual([['of:=0.4', '$Second.$A$1'], ['of:=0.2', '$First.$A$1']]);
  expect(X.read(bytes, { type: 'array' }).Workbook.Names).toEqual([
    { Name: 'Rate', Ref: '0.4', Sheet: 1 },
    { Name: 'Rate', Ref: '0.2' },
  ]);
});
