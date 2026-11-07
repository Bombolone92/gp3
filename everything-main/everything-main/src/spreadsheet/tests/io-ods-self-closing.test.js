import { expect, it } from 'vitest';
import * as XLSX from '../src/vendor/xlsx.mjs';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';

function file(rows, extension = 'fods') {
  const root = extension === 'ods' ? 'document-content' : 'document';
  const xml = new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8"?>
<office:${root} xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
 xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"
 xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"
 xmlns:number="urn:oasis:names:tc:opendocument:xmlns:datastyle:1.0"
 xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"
 xmlns:of="urn:oasis:names:tc:opendocument:xmlns:of:1.2"
 office:version="1.2" office:mimetype="application/vnd.oasis.opendocument.spreadsheet">
 <office:automatic-styles>
  <number:number-style style:name="N1"><number:number number:decimal-places="2" number:min-integer-digits="1"/></number:number-style>
  <style:style style:name="ce1" style:family="table-cell" style:data-style-name="N1"/>
 </office:automatic-styles>
 <office:body><office:spreadsheet><table:table table:name="Data">${rows}</table:table></office:spreadsheet></office:body>
</office:${root}>`);
  if (extension === 'fods') return xml;
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([[0]]), 'Data');
  const zip = XLSX.CFB.read(new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'ods' })), { type: 'array' });
  XLSX.CFB.utils.cfb_add(zip, 'content.xml', xml);
  return XLSX.CFB.write(zip, { type: 'array', fileType: 'zip' });
}

const cases = [
  ['number', 'office:value-type="float" office:value="42.5"', 42.5],
  ['zero', 'office:value-type="float" office:value="0"', 0],
  ['percent', 'office:value-type="percentage" office:value="0.125"', 0.125],
  ['currency', 'office:value-type="currency" office:currency="EUR" office:value="-12.5"', -12.5],
  ['true', 'office:value-type="boolean" office:boolean-value="true"', true],
  ['false', 'office:value-type="boolean" office:boolean-value="false"', false],
  ['date', 'office:value-type="date" office:date-value="2024-01-15"', 45306],
  ['time', 'office:value-type="time" office:time-value="PT12H30M15S"', 45015 / 86400],
  ['text', 'office:value-type="string" office:string-value="hello &amp; goodbye"', 'hello & goodbye'],
  ['formula', 'office:value-type="float" office:value="14" table:formula="of:=[.B1]*2"', 14],
  ['formula without cache', 'table:formula="of:=2*3"', 6],
];

it.each(cases.flatMap(([name, attrs, expected]) => ['fods', 'ods'].map((extension) => ({ name, attrs, expected, extension }))))(
  'preserves a self-closing $name cell in $extension files', async ({ attrs, expected, extension }) => {
    const bytes = file(`<table:table-row><table:table-cell ${attrs}/><table:table-cell office:value-type="float" office:value="7"><text:p>7</text:p></table:table-cell></table:table-row>`, extension);
    const wb = await workbookFromFile(bytes, `compact.${extension}`);
    for (const back of [wb, await workbookFromFile(await workbookToXlsx(wb), 'saved.xlsx')]) {
      expect(back.getValue(back.activeSheetId, 0, 0)).toBe(expected);
      expect(back.getValue(back.activeSheetId, 0, 1)).toBe(7);
    }
  },
);

it.each([false, true])('keeps repeated styled cells and row positions with dense=%s', async (dense) => {
  const bytes = file(`<table:table-row table:number-rows-repeated="2">
    <table:table-cell office:value-type="float" office:value="42.5" table:style-name="ce1" table:number-columns-repeated="3"/>
    <table:table-cell office:value-type="string"><text:p>End</text:p></table:table-cell>
  </table:table-row>`);
  const raw = XLSX.read(bytes, { type: 'array', cellNF: true, dense });
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 3; c++) {
      const cell = dense ? raw.Sheets.Data['!data'][r][c] : raw.Sheets.Data[XLSX.utils.encode_cell({ r, c })];
      expect(cell).toMatchObject({ t: 'n', v: 42.5, z: '0.00' });
    }
  }
  const wb = await workbookFromFile(bytes, 'repeat.fods');
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 3; c++) expect(wb.getDisplay(wb.activeSheetId, r, c)).toBe('42.50');
    expect(wb.getValue(wb.activeSheetId, r, 3)).toBe('End');
  }
});

it.each([false, true].flatMap((dense) => ['', 'office:value-type="void"'].map((type) => ({ dense, type })) ))(
  'skips large blank runs without allocating cells with dense=$dense and type=$type', ({ dense, type }) => {
    const bytes = file(`<table:table-row><table:table-cell ${type} table:number-columns-repeated="1024"/><table:table-cell office:value-type="float" office:value="9"/></table:table-row>`);
    const sheet = XLSX.read(bytes, { type: 'array', dense, sheetStubs: true }).Sheets.Data;
    if (dense) {
      expect(Object.keys(sheet['!data'][0])).toHaveLength(1);
      expect(sheet['!data'][0][1024]).toMatchObject({ t: 'n', v: 9 });
    } else {
      expect(Object.keys(sheet).filter((key) => !key.startsWith('!'))).toEqual(['AMK1']);
      expect(sheet.AMK1).toMatchObject({ t: 'n', v: 9 });
    }
  },
);
