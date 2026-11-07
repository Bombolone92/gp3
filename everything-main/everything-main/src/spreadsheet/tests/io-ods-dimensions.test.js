import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToOds } from '../src/core/io.js';

// The ODS writer declared column widths and row heights as automatic styles, but the reader
// skipped those styles, so every ODS file opened with default columns and rows.
it('brings column widths and row heights back from an ODS file', async () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, 'x');
  wb.setInput(id, 6, 3, 'y');
  wb.setColWidth(id, 0, 150);
  wb.setColWidth(id, 2, 60);
  wb.setRowHeight(id, 3, 40);
  wb.setRowHeight(id, 4, 40);
  const copy = await workbookFromFile(await workbookToOds(wb, { settings: false }), 'dims.ods');
  const cid = copy.activeSheetId;
  expect(copy.colWidth(cid, 0)).toBe(150);
  expect(copy.colWidth(cid, 1)).toBe(wb.colWidth(id, 1));
  expect(copy.colWidth(cid, 2)).toBe(60);
  expect(copy.rowHeight(cid, 3)).toBe(40);
  expect(copy.rowHeight(cid, 4)).toBe(40);
  expect(copy.rowHeight(cid, 5)).toBe(wb.rowHeight(id, 5));
});

it('reads widths in other units and leaves automatic heights alone', async () => {
  const X = await import('../src/vendor/xlsx.mjs');
  const flat = `<?xml version="1.0" encoding="UTF-8"?>
<office:document xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" office:version="1.2" office:mimetype="application/vnd.oasis.opendocument.spreadsheet">
<office:automatic-styles>
<style:style style:name="co1" style:family="table-column"><style:table-column-properties fo:break-before="auto" style:column-width="2.54cm"/></style:style>
<style:style style:name="co2" style:family="table-column"><style:table-column-properties fo:break-before="auto" style:column-width="1in"/></style:style>
<style:style style:name="ro1" style:family="table-row"><style:table-row-properties style:row-height="0.5in" style:use-optimal-row-height="false"/></style:style>
<style:style style:name="ro2" style:family="table-row"><style:table-row-properties style:row-height="0.3in" style:use-optimal-row-height="true"/></style:style>
</office:automatic-styles>
<office:body><office:spreadsheet>
<table:table table:name="Sheet1">
<table:table-column table:style-name="co1"/>
<table:table-column table:style-name="co2" table:number-columns-repeated="2"/>
<table:table-column table:style-name="co2" table:visibility="collapse"/>
<table:table-row table:style-name="ro1"><table:table-cell office:value-type="string"><text:p>a</text:p></table:table-cell></table:table-row>
<table:table-row table:style-name="ro2"><table:table-cell office:value-type="string"><text:p>b</text:p></table:table-cell></table:table-row>
</table:table>
</office:spreadsheet></office:body></office:document>`;
  const book = X.read(flat, { type: 'string' });
  const ws = book.Sheets.Sheet1;
  expect(ws['!cols'].map((c) => c.wpx)).toEqual([96, 96, 96, 96]);
  expect(ws['!cols'][3].hidden).toBe(true);
  expect(ws['!rows'][0].hpx).toBe(48);
  expect(ws['!rows'][1]?.hpx).toBeUndefined();
});
