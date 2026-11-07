import { expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import * as XLSX from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToOds } from '../src/core/io.js';

const parser = new (new JSDOM('').window.DOMParser)();
const tableNS = 'urn:oasis:names:tc:opendocument:xmlns:table:1.0';
const quote = (s) => `"${s.replaceAll('"', '""')}"`;
const escape = (s) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const texts = ['hello, world', 'semi;colon', 'a|b~c', 'A1 $B$2 [.C3]', 'COM.MICROSOFT.TEST',
  'He said "A1;|~, "', 'https://example.com/?a=1&b=2|3'];

it.each(texts)('exports formula strings literally: %s', async (text) => {
  let wb = new Workbook();
  wb.setInput(wb.activeSheetId, 0, 0, '7');
  const formula = `CONCATENATE(${quote(text)},A1,${quote(text)})`;
  wb.setInput(wb.activeSheetId, 0, 1, `=${formula}`);
  for (let round = 0; round < 2; round++) {
    const bytes = new Uint8Array(await (await workbookToOds(wb)).arrayBuffer());
    const zip = XLSX.CFB.read(bytes, { type: 'array' });
    const doc = parser.parseFromString(new TextDecoder().decode(XLSX.CFB.find(zip, 'content.xml').content), 'application/xml');
    expect(doc.querySelector('parsererror')?.textContent).toBeUndefined();
    const cells = [...doc.getElementsByTagNameNS(tableNS, 'table-cell')];
    expect(cells.find((cell) => cell.hasAttributeNS(tableNS, 'formula')).getAttributeNS(tableNS, 'formula'))
      .toBe(`of:=CONCATENATE(${quote(text)};[.A1];${quote(text)})`);
    wb = await workbookFromFile(bytes, 'strings.ods');
    expect(wb.getCell(wb.activeSheetId, 0, 1).f).toBe(formula);
    expect(wb.getValue(wb.activeSheetId, 0, 1)).toBe(`${text}7${text}`);
  }
});

it.each(texts)('imports literal strings while converting ODS syntax: %s', async (text) => {
  const formula = `of:=CONCATENATE(${quote(text)};COM.MICROSOFT.ABS(-7);${quote(text)})`;
  const content = new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8"?>
    <office:document xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
      xmlns:table="${tableNS}" office:mimetype="application/vnd.oasis.opendocument.spreadsheet" office:version="1.2">
      <office:body><office:spreadsheet><table:table table:name="Data"><table:table-row>
        <table:table-cell office:value-type="string" table:formula="${escape(formula)}"/>
      </table:table-row></table:table></office:spreadsheet></office:body>
    </office:document>`);
  const wb = await workbookFromFile(content, 'strings.fods');
  expect(wb.getCell(wb.activeSheetId, 0, 0).f).toBe(`CONCATENATE(${quote(text)},ABS(-7),${quote(text)})`);
  expect(wb.getValue(wb.activeSheetId, 0, 0)).toBe(`${text}7${text}`);
});

it('converts array separators while preserving quoted array elements', async () => {
  let wb = new Workbook();
  const formula = '{"a,b","c;d";"e|f","g~h"}';
  wb.setInput(wb.activeSheetId, 0, 0, `=${formula}`);
  for (let round = 0; round < 2; round++) {
    wb = await workbookFromFile(await workbookToOds(wb), 'array.ods');
    expect(wb.getCell(wb.activeSheetId, 0, 0).f).toBe(formula);
    expect([0, 1].map((r) => [0, 1].map((c) => wb.getValue(wb.activeSheetId, r, c))))
      .toEqual([['a,b', 'c;d'], ['e|f', 'g~h']]);
  }
});
