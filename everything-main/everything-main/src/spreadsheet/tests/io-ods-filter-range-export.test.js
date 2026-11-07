import { expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import * as X from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToOds } from '../src/core/io.js';
const parser = new (new JSDOM('').window.DOMParser)();
const NS = 'urn:oasis:names:tc:opendocument:xmlns:table:1.0';
function content(bytes, format) {
  if (format === 'fods') return new TextDecoder().decode(bytes);
  const zip = X.CFB.read(bytes, { type: 'array' }); return new TextDecoder().decode(X.CFB.find(zip, 'content.xml').content);
}
function ranges(bytes, format = 'ods') {
  const doc = parser.parseFromString(content(bytes, format), 'application/xml');
  expect(doc.querySelector('parsererror')).toBeNull();
  return [...doc.getElementsByTagNameNS(NS, 'database-range')];
}
it.each(['ods', 'fods'].flatMap(format => ['Data', 'Source Data', "Plan's.data", 'A & "B"', '_x0041_', '😀'].map(name => ({ format, name }))))(
  'writes a native filter range for $name in $format', async ({ format, name }) => {
    const book = X.utils.book_new(), sheet = X.utils.aoa_to_sheet([['Value'], [9]]);
    sheet['!autofilter'] = { ref: 'B2:D8' }; X.utils.book_append_sheet(book, sheet, name);
    const bytes = new Uint8Array(X.write(book, { type: 'array', bookType: format }));
    const defs = ranges(bytes, format); expect(defs).toHaveLength(1);
    expect(defs[0].getAttributeNS(NS, 'display-filter-buttons')).toBe('true');
    expect(defs[0].getAttributeNS(NS, 'contains-header')).toBe('true');
    expect(defs[0].getAttributeNS(NS, 'target-range-address')).toBe(`$'${name.replaceAll("'", "''")}'.$B$2:.$D$8`);
    expect(X.read(bytes, { type: 'array' }).Sheets[name]['!autofilter']).toEqual({ ref: '$B$2:$D$8' });
    const wb = await workbookFromFile(bytes, `filter.${format}`);
    expect(wb.sheets[0].filter).toEqual({ range: { r1: 1, c1: 1, r2: 7, c2: 3 }, criteria: {} });
  },
);
it('preserves independent filter ranges on multiple sheets over repeated ODS saves', async () => {
  let wb = new Workbook({ sheets: [{ name: 'First' }, { name: 'Second' }, { name: 'No filter' }] });
  const expected = [{ r1: 0, c1: 0, r2: 3, c2: 1 }, { r1: 1, c1: 2, r2: 4, c2: 4 }];
  expected.forEach((range, i) => wb.setFilterRange(wb.sheets[i].id, range));
  for (let i = 0; i < 2; i++) {
    const before = wb.toJSON(), bytes = new Uint8Array(await (await workbookToOds(wb)).arrayBuffer());
    const defs = ranges(bytes); expect(defs).toHaveLength(2);
    expect(new Set(defs.map(d => d.getAttributeNS(NS, 'name'))).size).toBe(2);
    expect(wb.toJSON()).toEqual(before);
    wb = await workbookFromFile(bytes, 'filters.ods');
    expected.forEach((range, i) => expect(wb.sheets[i].filter).toEqual({ range, criteria: {} }));
    expect(wb.sheets[2].filter).toBeNull();
  }
});
it('keeps an empty whole-sheet filter compact and sparse', async () => {
  const wb = new Workbook(), id = wb.activeSheetId, range = { r1: 0, c1: 0, r2: 19999, c2: 701 };
  wb.setFilterRange(id, range);
  const bytes = new Uint8Array(await (await workbookToOds(wb)).arrayBuffer());
  expect(ranges(bytes)).toHaveLength(1); expect(content(bytes, 'ods').length).toBeLessThan(10000);
  const reopened = await workbookFromFile(bytes, 'empty.ods');
  expect(reopened.sheets[0].filter.range).toEqual(range); expect(reopened.sheets[0].cells.size).toBe(0);
});
it('exports table-created filter buttons along with data and formulas', async () => {
  let wb = new Workbook(), id = wb.activeSheetId;
  wb.setInput(id, 0, 0, 'Amount'); wb.setInput(id, 1, 0, '9'); wb.setInput(id, 2, 0, '=3*4');
  wb.addTable(id, { r1: 0, c1: 0, r2: 2, c2: 0 }, { name: 'Items' });
  wb = await workbookFromFile(await workbookToOds(wb), 'table.ods');
  expect(wb.sheets[0].filter).toEqual({ range: { r1: 0, c1: 0, r2: 2, c2: 0 }, criteria: {} });
  expect(wb.getValue(wb.activeSheetId, 2, 0)).toBe(12);
});
it('does not create filter definitions on unfiltered sheets', async () => {
  const bytes = new Uint8Array(await (await workbookToOds(new Workbook())).arrayBuffer());
  expect(ranges(bytes)).toHaveLength(0); expect(content(bytes, 'ods')).not.toContain('<table:database-ranges>');
});
