import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { Workbook, MAX_ROWS, MAX_COLS } from '../src/core/workbook.js';
import { workbookFromFile, workbookToOds } from '../src/core/io.js';

async function contentXml(blob) {
  const zip = X.CFB.read(new Uint8Array(await blob.arrayBuffer()), { type: 'array' });
  return new TextDecoder().decode(X.CFB.find(zip, 'content.xml').content);
}
/** Every declared row of the first table: how many rows it covers, and any style or collapse it carries. */
function rowLayout(xml) {
  const table = xml.slice(xml.indexOf('<table:table '), xml.indexOf('</table:table>'));
  const rows = [];
  let index = 0;
  for (const tag of table.match(/<table:table-row\b[^>]*>/g)) {
    const repeat = Number(/table:number-rows-repeated="(\d+)"/.exec(tag)?.[1] || 1);
    const styled = /table:style-name="/.test(tag), collapsed = /table:visibility="collapse"/.test(tag);
    if (styled || collapsed) rows.push({ index, repeat, styled, collapsed });
    index += repeat;
  }
  return { total: index, rows };
}

// The writer walked rows only up to the sheet's used range, so a row height or hidden
// row further down got a style declared but never referenced, and other programs opened
// the file with that row at its default height and visible.
it('writes a row height or hidden row past the used range, repeating the empty rows before it', async () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.ensureSize(id, MAX_ROWS, MAX_COLS);
  wb.setInput(id, 0, 0, 'a');
  wb.setInput(id, 2, 1, 'b');
  wb.setRowHeight(id, 10, 40);
  wb.setHidden(id, 'row', [12, 20, 21, 22], true);
  wb.setRowHeight(id, MAX_ROWS - 1, 60);
  const blob = await workbookToOds(wb, { settings: false });
  expect(blob.size).toBeLessThan(20_000);
  const layout = rowLayout(await contentXml(blob));
  expect(layout.total).toBe(MAX_ROWS);
  expect(layout.rows).toEqual([
    { index: 10, repeat: 1, styled: true, collapsed: false },
    { index: 12, repeat: 1, styled: true, collapsed: true },
    { index: 20, repeat: 1, styled: true, collapsed: true },
    { index: 21, repeat: 1, styled: true, collapsed: true },
    { index: 22, repeat: 1, styled: true, collapsed: true },
    { index: MAX_ROWS - 1, repeat: 1, styled: true, collapsed: false },
  ]);

  const back = await workbookFromFile(blob, 'far-rows.ods');
  const bid = back.activeSheetId;
  expect(back.getValue(bid, 0, 0)).toBe('a');
  expect(back.getValue(bid, 2, 1)).toBe('b');
  expect(back.sheets[0].cells.size).toBe(2);
  expect(back.rowHeight(bid, 10)).toBe(40);
  expect(back.rowHeight(bid, 11)).toBe(wb.rowHeight(id, 11));
  expect([12, 20, 21, 22].map((r) => back.isRowHidden(bid, r))).toEqual([true, true, true, true]);
  expect(back.isRowHidden(bid, 13)).toBe(false);
  expect(back.rowHeight(bid, MAX_ROWS - 1)).toBe(60);
});

it('writes the far row layout of a sheet that also has validation rules', async () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '5');
  wb.addValidation(id, { type: 'list', source: '1, 5, 9', range: { r1: 0, c1: 0, r2: 4, c2: 0 }, strict: true });
  wb.setRowHeight(id, 30, 40);
  wb.setHidden(id, 'row', [40], true);
  const blob = await workbookToOds(wb, { settings: false });
  const layout = rowLayout(await contentXml(blob));
  expect(layout.total).toBe(41);
  expect(layout.rows).toEqual([
    { index: 30, repeat: 1, styled: true, collapsed: false },
    { index: 40, repeat: 1, styled: true, collapsed: true },
  ]);
  const back = await workbookFromFile(blob, 'far-rows-validation.ods');
  const bid = back.activeSheetId;
  expect(back.getValue(bid, 0, 0)).toBe(5);
  expect(back.sheets[0].validations).toHaveLength(1);
  expect(back.rowHeight(bid, 30)).toBe(40);
  expect(back.isRowHidden(bid, 40)).toBe(true);
});
