import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToOds } from '../src/core/io.js';

async function exported(wb) {
  const bytes = new Uint8Array(await (await workbookToOds(wb, { settings: false })).arrayBuffer());
  const content = new TextDecoder().decode(X.CFB.find(X.CFB.read(bytes, { type: 'array' }), 'content.xml').content);
  return { bytes, content, back: await workbookFromFile(bytes, 'layout.ods') };
}

// Columns were declared only up to the last used column, so a width or a hidden state set on
// a column past the data was lost through an .ods, while a row height past the data survived.
it('keeps a column width and a hidden column set past the used range through an .ods', async () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, 'a');
  wb.setColWidth(id, 20, 200);
  expect(wb.setHidden(id, 'col', [23], true)).toBe(true);
  wb.setRowHeight(id, 700, 60);
  const { content, back } = await exported(wb);
  const bid = back.activeSheetId;
  expect(back.colWidth(bid, 20)).toBe(200);
  expect(back.activeSheet.hiddenCols.has(23)).toBe(true);
  expect([...back.activeSheet.colWidths]).toEqual([[20, 200]]);
  expect([...back.activeSheet.rowHeights]).toEqual([[700, 60]]);
  // The declarations cover the far column in a few runs, and each row's empty run is one repeated cell.
  const table = content.slice(content.indexOf('<table:table '));
  const declarations = [...table.slice(0, table.indexOf('<table:table-row')).matchAll(/<table:table-column\b[^>]*>/g)].map((m) => m[0]);
  expect(declarations.reduce((n, tag) => n + Number(/number-columns-repeated="(\d+)"/.exec(tag)?.[1] || 1), 0)).toBe(24);
  expect(declarations.length).toBeLessThanOrEqual(5);
  const firstRow = table.slice(table.indexOf('<table:table-row'), table.indexOf('</table:table-row>'));
  expect((firstRow.match(/<table:table-cell/g) || []).length).toBe(2);
  expect(firstRow).toContain('table:number-columns-repeated="23"');
});

it('does not stretch a sheet whose column layout ends within its data', async () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 4, 'e');
  wb.setColWidth(id, 1, 150);
  const { content } = await exported(wb);
  const table = content.slice(content.indexOf('<table:table '));
  const declarations = [...table.slice(0, table.indexOf('<table:table-row')).matchAll(/<table:table-column\b[^>]*>/g)].map((m) => m[0]);
  expect(declarations.reduce((n, tag) => n + Number(/number-columns-repeated="(\d+)"/.exec(tag)?.[1] || 1), 0)).toBe(5);
});
