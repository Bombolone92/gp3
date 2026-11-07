import { expect, it } from 'vitest';
import * as XLSX from '../src/vendor/xlsx.mjs';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';

function file(rows, extension = 'fods') {
  const root = extension === 'ods' ? 'document-content' : 'document';
  const xml = new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8"?>
<office:${root} xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
 xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"
 xmlns:of="urn:oasis:names:tc:opendocument:xmlns:of:1.2"
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
  [undefined, 3].map((repeat) => ({ extension, selfClosing, repeat })),
)))(
  'keeps row positions in $extension with selfClosing=$selfClosing and repeat=$repeat', async ({ extension, selfClosing, repeat }) => {
    const n = repeat || 1;
    const attrs = repeat == null ? '' : ` table:number-rows-repeated="${repeat}"`;
    const empty = selfClosing ? `<table:table-row${attrs}/>` : `<table:table-row${attrs}></table:table-row>`;
    const source = `A${n + 1}`;
    const bytes = file(`${empty}
      <table:table-row><table:table-cell office:value-type="float" office:value="7"/></table:table-row>
      ${empty}
      <table:table-row><table:table-cell table:formula="of:=[.${source}]*2" office:value-type="float" office:value="14"/></table:table-row>`, extension);
    for (const dense of [false, true]) {
      const raw = XLSX.read(bytes, { type: 'array', dense }).Sheets.Data;
      expect(raw['!ref']).toBe(`${source}:A${2 * n + 2}`);
    }
    const wb = await workbookFromFile(bytes, `rows.${extension}`);
    for (const back of [wb, await workbookFromFile(await workbookToXlsx(wb), 'saved.xlsx')]) {
      expect(back.getValue(back.activeSheetId, n, 0)).toBe(7);
      expect(back.getCell(back.activeSheetId, 2 * n + 1, 0).f).toBe(`${source}*2`);
      expect(back.getValue(back.activeSheetId, 2 * n + 1, 0)).toBe(14);
      expect(back.getValue(back.activeSheetId, 0, 0)).toBeNull();
      expect(back.getValue(back.activeSheetId, n + 1, 0)).toBeNull();
      expect(back.activeSheet.cells.size).toBe(2);
    }
  },
);

it.each([false, true])('handles a large leading blank row run without allocating it, dense=%s', (dense) => {
  const bytes = file(`<table:table-row table:number-rows-repeated="1048575"/>
    <table:table-row><table:table-cell office:value-type="float" office:value="7"/></table:table-row>`);
  const sheet = XLSX.read(bytes, { type: 'array', dense, sheetStubs: true }).Sheets.Data;
  expect(sheet['!ref']).toBe('A1048576');
  if (dense) {
    expect(Object.keys(sheet['!data'])).toEqual(['1048575']);
    expect(sheet['!data'][1048575][0]).toMatchObject({ t: 'n', v: 7 });
  } else {
    expect(Object.keys(sheet).filter((key) => !key.startsWith('!'))).toEqual(['A1048576']);
    expect(sheet.A1048576).toMatchObject({ t: 'n', v: 7 });
  }
});

it('leaves trailing empty rows outside the used range', async () => {
  const bytes = file(`<table:table-row><table:table-cell office:value-type="float" office:value="7"/></table:table-row>
    <table:table-row table:number-rows-repeated="1048575"/>`);
  expect(XLSX.read(bytes, { type: 'array' }).Sheets.Data['!ref']).toBe('A1');
  const wb = await workbookFromFile(bytes, 'trailing.fods');
  expect(wb.activeSheet.cells.size).toBe(1);
  expect(wb.getValue(wb.activeSheetId, 0, 0)).toBe(7);
});
