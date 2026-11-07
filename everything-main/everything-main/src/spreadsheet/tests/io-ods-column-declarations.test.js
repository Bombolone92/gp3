import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToOds } from '../src/core/io.js';

function content(bytes) {
  const zip = X.CFB.read(new Uint8Array(bytes), { type: 'array' });
  return new TextDecoder().decode(X.CFB.find(zip, 'content.xml').content);
}
function columns(xml) {
  const table = xml.slice(xml.indexOf('<table:table '));
  const header = table.slice(0, table.indexOf('<table:table-row'));
  return [...header.matchAll(/<table:table-column\b[^>]*>/g)].map(([tag]) => ({
    tag, count: Number(/table:number-columns-repeated="(\d+)"/.exec(tag)?.[1] || 1),
  }));
}
it.each(['empty', 'values', 'formula'])('declares default columns before the rows of an %s sheet', async (kind) => {
  const wb = new Workbook(), id = wb.activeSheetId;
  if (kind !== 'empty') wb.setInput(id, 2, 3, kind === 'formula' ? '=2*3' : 'Value');
  const blob = await workbookToOds(wb), xml = content(await blob.arrayBuffer()), declarations = columns(xml);
  expect(declarations).toHaveLength(1);
  expect(declarations[0].count).toBe(kind === 'empty' ? 1 : 4);
  expect(declarations[0].tag).not.toContain('style-name');
  const copy = await workbookFromFile(blob, 'columns.ods');
  expect(copy.getValue(copy.activeSheetId, 2, 3)).toBe(kind === 'empty' ? null : kind === 'formula' ? 6 : 'Value');
});
it.each([false, true])('declares large validation-only column areas compactly with widths=%s', async (widths) => {
  const wb = new Workbook(), id = wb.activeSheetId;
  if (widths) wb.setColWidth(id, 0, 137);
  wb.addValidation(id, { type: 'list', source: 'Yes, No', range: { r1: 0, c1: 0, r2: 1048575, c2: 16383 } });
  const blob = await workbookToOds(wb), xml = content(await blob.arrayBuffer()), declarations = columns(xml);
  expect(declarations.reduce((n, col) => n + col.count, 0)).toBe(16384);
  expect(declarations.length).toBeLessThanOrEqual(2);
  expect(xml.length).toBeLessThan(20000);
  if (widths) expect(declarations[0].tag).toContain('table:style-name="co0"');
  const copy = await workbookFromFile(blob, 'whole.ods');
  expect(copy.validationAt(copy.activeSheetId, 1048575, 16383)?.type).toBe('list');
});
it('retains custom width assignments and the default columns between them', async () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setInput(id, 0, 4, 'Last'); wb.setColWidth(id, 0, 137); wb.setColWidth(id, 3, 222);
  const xml = content(await (await workbookToOds(wb)).arrayBuffer()), declarations = columns(xml);
  const expanded = declarations.flatMap(col => Array.from({ length: col.count }, () => /table:style-name="([^"]+)"/.exec(col.tag)?.[1] || null));
  expect(expanded).toHaveLength(5);
  expect(xml).toContain('style:column-width="137px"'); expect(xml).toContain('style:column-width="222px"');
  // The default columns between them carry no style of their own.
  expect(expanded).toEqual(['co0', null, null, 'co1', null]);
});
it('writes a column declaration in flat OpenDocument exports too', () => {
  const book = X.utils.book_new(); X.utils.book_append_sheet(book, X.utils.aoa_to_sheet([['A', 'B']]), 'Data');
  const xml = X.write(book, { type: 'string', bookType: 'fods' });
  expect(columns(xml).reduce((n, col) => n + col.count, 0)).toBe(2);
});
