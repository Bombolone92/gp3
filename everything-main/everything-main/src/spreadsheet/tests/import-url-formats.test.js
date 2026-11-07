import { expect, it } from 'vitest';
import { IMPORT_EXTENSIONS, workbookFromFile } from '../src/core/io.js';
import { importNameFor } from '../src/core/importrange.js';

it.each(IMPORT_EXTENSIONS)('retains the supported %s filename from a URL', (ext) => {
  for (const suffix of [ext, ext.toUpperCase()]) {
    expect(importNameFor(`https://example.com/Quarter%201${suffix}?download=1#file`, new Uint8Array([1, 2, 3, 4])))
      .toBe(`Quarter 1${suffix}`);
  }
});

it('routes a FODS URL through the spreadsheet reader and preserves sheets, values, and formulas', async () => {
  const bytes = new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8"?>
    <office:document xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
      xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"
      xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"
      xmlns:of="urn:oasis:names:tc:opendocument:xmlns:of:1.2"
      office:mimetype="application/vnd.oasis.opendocument.spreadsheet" office:version="1.2">
      <office:body><office:spreadsheet>
        <table:table table:name="Values">
          <table:table-row><table:table-cell office:value-type="float" office:value="42"/></table:table-row>
          <table:table-row><table:table-cell table:formula="of:=[.A1]+3" office:value-type="float" office:value="45"/></table:table-row>
        </table:table>
        <table:table table:name="Notes">
          <table:table-row><table:table-cell office:value-type="string"><text:p>Report</text:p></table:table-cell></table:table-row>
        </table:table>
      </office:spreadsheet></office:body>
    </office:document>`);
  const direct = await workbookFromFile(bytes, 'Report.fods');
  expect(direct.sheets.map((sheet) => sheet.name)).toEqual(['Values', 'Notes']);
  const imported = await workbookFromFile(bytes, importNameFor('https://example.com/Report.fods', bytes));
  expect(imported.sheets.map((sheet) => sheet.name)).toEqual(['Values', 'Notes']);
  const id = imported.sheets[0].id;
  expect(imported.getValue(id, 0, 0)).toBe(42);
  expect(imported.getValue(id, 1, 0)).toBe(45);
  expect(imported.getCell(id, 1, 0).f).toBe('A1+3');
  expect(imported.getValue(imported.sheets[1].id, 0, 0)).toBe('Report');
  imported.setInput(id, 0, 0, '10');
  expect(imported.getValue(id, 1, 0)).toBe(13);
});
