import { expect, it } from 'vitest';
import * as XLSX from '../src/vendor/xlsx.mjs';
import { workbookFromFile, workbookToOds } from '../src/core/io.js';

function content(sheet, target) {
  return new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8"?>
    <office:document xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
      xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"
      office:mimetype="application/vnd.oasis.opendocument.spreadsheet" office:version="1.2">
      <office:body><office:spreadsheet><table:table table:name="${sheet}"><table:table-row>
        <table:table-cell office:value-type="float" office:value="42"/>
      </table:table-row></table:table><table:database-ranges>
        <table:database-range table:name="Filter" table:display-filter-buttons="true" table:target-range-address="${target}.A1:B2"/>
      </table:database-ranges></office:spreadsheet></office:body>
    </office:document>`);
}

it.each(['__proto__', 'constructor', 'toString', 'hasOwnProperty'])(
  'ignores a missing filter sheet named %s without modifying inherited objects', (name) => {
    const inherited = ({})[name];
    const before = Object.getOwnPropertyDescriptor(inherited, '!autofilter');
    let after, book;
    try {
      book = XLSX.read(content('Data', name), { type: 'array' });
      after = Object.getOwnPropertyDescriptor(inherited, '!autofilter');
    } finally {
      if (before) Object.defineProperty(inherited, '!autofilter', before);
      else delete inherited['!autofilter'];
    }
    expect(after).toEqual(before);
    expect(book.SheetNames).toEqual(['Data']);
    expect(Object.hasOwn(book.Sheets, name)).toBe(false);
    expect(book.Sheets.Data.A1.v).toBe(42);
    expect(book.Sheets.Data['!autofilter']).toBeUndefined();
  },
);

it.each(['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'Data'])(
  'stores the real sheet %s as an own entry and applies its filter', async (name) => {
    const bytes = content(name, name);
    const raw = XLSX.read(bytes, { type: 'array' });
    expect(Object.hasOwn(raw.Sheets, name)).toBe(true);
    expect(Object.keys(raw.Sheets)).toEqual([name]);
    expect(raw.Sheets[name]['!autofilter']).toEqual({ ref: 'A1:B2' });
    let wb = await workbookFromFile(bytes, 'sheets.fods');
    expect(wb.sheets[0].name).toBe(name);
    expect(wb.getValue(wb.activeSheetId, 0, 0)).toBe(42);
    wb = await workbookFromFile(await workbookToOds(wb), 'sheets.ods');
    expect(wb.sheets[0].name).toBe(name);
    expect(wb.getValue(wb.activeSheetId, 0, 0)).toBe(42);
  },
);
