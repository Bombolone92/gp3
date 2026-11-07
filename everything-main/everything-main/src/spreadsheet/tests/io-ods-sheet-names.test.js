import { expect, it } from 'vitest';
import * as XLSX from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToOds } from '../src/core/io.js';
import { quoteSheet } from '../src/core/refs.js';

it.each(['A & B', "Plan's data", 'A "B"', 'x < y', 'x > y', 'literal &amp;'])(
  'preserves ODS sheet name %s and formulas referring to it', async (name) => {
    let wb = new Workbook();
    const source = wb.activeSheetId;
    wb.renameSheet(source, name); wb.setInput(source, 0, 0, '42');
    const summary = wb.addSheet('Summary').id;
    wb.setInput(summary, 0, 0, `=${quoteSheet(name)}!A1+1`);
    for (let round = 0; round < 2; round++) {
      const bytes = await (await workbookToOds(wb)).arrayBuffer();
      const raw = XLSX.read(bytes, { type: 'array' });
      expect(raw.SheetNames).toEqual([name, 'Summary']);
      expect(Object.hasOwn(raw.Sheets, name)).toBe(true);
      wb = await workbookFromFile(bytes, 'names.ods');
      expect(wb.sheets.map((s) => s.name)).toEqual([name, 'Summary']);
      expect(wb.getValue(wb.sheetByName(name).id, 0, 0)).toBe(42);
      expect(wb.getValue(wb.sheetByName('Summary').id, 0, 0)).toBe(43);
    }
  });

it.each([
  ['&#x1F600;', '😀'], ['&#128512;', '😀'], ['North&#38;South', 'North&South'],
  ['Plan&#39;s data', "Plan's data"], ['A&#x22;B', 'A"B'], ['literal &amp;amp;', 'literal &amp;'],
  ['_x0041_', '_x0041_'], ['&#95;x0041_', '_x0041_'], ['_x005F_x0041_', '_x005F_x0041_'],
])('decodes FODS sheet name %s once', async (encoded, name) => {
  const content = new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8"?>
    <office:document xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
      xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"
      office:mimetype="application/vnd.oasis.opendocument.spreadsheet" office:version="1.2">
      <office:body><office:spreadsheet><table:table table:name="${encoded}"><table:table-row>
        <table:table-cell office:value-type="float" office:value="42"/>
      </table:table-row></table:table></office:spreadsheet></office:body>
    </office:document>`);
  const wb = await workbookFromFile(content, 'names.fods');
  expect(wb.sheets[0].name).toBe(name);
  expect(wb.getValue(wb.sheets[0].id, 0, 0)).toBe(42);
  const reopened = await workbookFromFile(await workbookToOds(wb), 'saved.ods');
  expect(reopened.sheets[0].name).toBe(name);
  expect(reopened.getValue(reopened.sheets[0].id, 0, 0)).toBe(42);
});
