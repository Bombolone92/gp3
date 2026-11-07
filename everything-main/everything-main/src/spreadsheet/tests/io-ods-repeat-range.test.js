import { expect, it } from 'vitest';
import * as XLSX from '../src/vendor/xlsx.mjs';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';

function file(rows, extension = 'fods') {
  const root = extension === 'ods' ? 'document-content' : 'document';
  const xml = new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8"?>
<office:${root} xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
 xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"
 xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"
 office:version="1.2" office:mimetype="application/vnd.oasis.opendocument.spreadsheet">
 <office:body><office:spreadsheet><table:table table:name="Data">${rows}</table:table></office:spreadsheet></office:body>
</office:${root}>`);
  if (extension === 'fods') return xml;
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([[0]]), 'Data');
  const zip = XLSX.CFB.read(new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'ods' })), { type: 'array' });
  XLSX.CFB.utils.cfb_add(zip, 'content.xml', xml);
  return XLSX.CFB.write(zip, { type: 'array', fileType: 'zip' });
}

it.each(['ods', 'fods'].flatMap((extension) => [false, true].flatMap((selfClosing) =>
  [1, 3, 26].map((repeat) => ({ extension, selfClosing, repeat })),
)))(
  'keeps all $repeat repeated cells in $extension files with selfClosing=$selfClosing', async ({ extension, selfClosing, repeat }) => {
    const attrs = `office:value-type="float" office:value="7" table:number-columns-repeated="${repeat}"`;
    const cell = selfClosing ? `<table:table-cell ${attrs}/>` : `<table:table-cell ${attrs}><text:p>7</text:p></table:table-cell>`;
    const bytes = file(`<table:table-row table:number-rows-repeated="2">
      <table:table-cell table:number-columns-repeated="2"/>${cell}
      <table:table-cell table:number-columns-repeated="1024"/>
    </table:table-row>`, extension);
    const expectedRange = XLSX.utils.encode_range({ s: { r: 0, c: 2 }, e: { r: 1, c: 2 + repeat - 1 } });
    for (const dense of [false, true]) {
      const sheet = XLSX.read(bytes, { type: 'array', dense }).Sheets.Data;
      expect(sheet['!ref']).toBe(expectedRange);
    }
    const wb = await workbookFromFile(bytes, `repeats.${extension}`);
    for (const back of [wb, await workbookFromFile(await workbookToXlsx(wb), 'saved.xlsx')]) {
      for (let r = 0; r < 2; r++) {
        for (let c = 2; c < 2 + repeat; c++) expect(back.getValue(back.activeSheetId, r, c)).toBe(7);
        expect(back.getValue(back.activeSheetId, r, 1)).toBeNull();
        expect(back.getValue(back.activeSheetId, r, 2 + repeat)).toBeNull();
      }
    }
  },
);

it('retains the widest repeated row when later rows are shorter', async () => {
  const bytes = file(`<table:table-row>
    <table:table-cell office:value-type="string" table:number-columns-repeated="5"><text:p>Keep</text:p></table:table-cell>
  </table:table-row><table:table-row>
    <table:table-cell office:value-type="float" office:value="2"><text:p>2</text:p></table:table-cell>
  </table:table-row>`);
  expect(XLSX.read(bytes, { type: 'array' }).Sheets.Data['!ref']).toBe('A1:E2');
  const wb = await workbookFromFile(bytes, 'width.fods');
  for (let c = 0; c < 5; c++) expect(wb.getValue(wb.activeSheetId, 0, c)).toBe('Keep');
  expect(wb.getValue(wb.activeSheetId, 1, 0)).toBe(2);
  expect(wb.getValue(wb.activeSheetId, 1, 4)).toBeNull();
});
