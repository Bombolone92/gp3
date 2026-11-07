import { expect, it } from 'vitest';
import * as XLSX from '../src/vendor/xlsx.mjs';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';

const modes = ['fods', 'ods'];
function file(mode, tables) {
  const ns = `xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
    xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"
    xmlns:number="urn:oasis:names:tc:opendocument:xmlns:datastyle:1.0"
    xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"`;
  const definitions = [1, 2, 3].map((n) => `<number:number-style style:name="N${n}"><number:number number:decimal-places="${n}" number:min-integer-digits="1"/></number:number-style><style:style style:name="s${n}" style:family="table-cell" style:data-style-name="N${n}"/>`).join('')
    + `<style:style style:name="empty" style:family="table-cell"/>
      <style:style style:name="inherited" style:family="table-cell" style:parent-style-name="s3"/>
      <number:date-style style:name="ND"><number:year number:style="long"/><number:text>-</number:text><number:month number:style="long"/><number:text>-</number:text><number:day number:style="long"/></number:date-style>
      <style:style style:name="date" style:family="table-cell" style:data-style-name="ND"/>`;
  const root = mode === 'fods' ? 'document' : 'document-content';
  const content = new TextEncoder().encode(`<?xml version="1.0"?><office:${root} ${ns} office:version="1.2" office:mimetype="application/vnd.oasis.opendocument.spreadsheet">
    ${mode === 'fods' ? `<office:styles>${definitions}</office:styles>` : ''}
    <office:body><office:spreadsheet>${tables}</office:spreadsheet></office:body></office:${root}>`);
  if (mode === 'fods') return content;
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([[0]]), 'Data');
  const zip = XLSX.CFB.read(new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'ods' })), { type: 'array' });
  XLSX.CFB.utils.cfb_add(zip, 'content.xml', content);
  XLSX.CFB.utils.cfb_add(zip, 'styles.xml', new TextEncoder().encode(`<?xml version="1.0"?><office:document-styles ${ns} office:version="1.2"><office:styles>${definitions}</office:styles></office:document-styles>`));
  return XLSX.CFB.write(zip, { type: 'array', fileType: 'zip' });
}
const column = (name, repeat = 1) => `<table:table-column table:number-columns-repeated="${repeat}"${name ? ` table:default-cell-style-name="${name}"` : ''}/>`;
const cell = (attributes = '', selfClosing = true, value = 7.5) => `<table:table-cell office:value-type="float" office:value="${value}" ${attributes}${selfClosing ? '/>' : '></table:table-cell>'}`;

it.each(modes.flatMap((mode) => [false, true].map((selfClosing) => ({ mode, selfClosing }))))(
  'applies row and column defaults with cell overrides and repeated cells: %j', async ({ mode, selfClosing }) => {
    const cells = (attrs = '') => cell(attrs, selfClosing);
    const tables = `<table:table table:name="Data">${column('s1')}${column('s2', 2)}${column(null)}${column('inherited')}
      <table:table-row table:default-cell-style-name="inherited">${cells('table:number-columns-repeated="5"')}</table:table-row>
      <table:table-row table:number-rows-repeated="2">${cells('table:style-name="empty" table:number-columns-repeated="5"')}</table:table-row>
      <table:table-row table:default-cell-style-name="s1">${cells('table:style-name="s2"')}${cells('table:style-name="inherited"')}${cells('table:style-name="empty"')}${cells('table:style-name="missing"')}${cells()}</table:table-row>
      <table:table-row table:default-cell-style-name="empty"><table:table-cell table:number-columns-repeated="4"/>${cells()}</table:table-row>
    </table:table>
    <table:table table:name="Next"><table:table-row>${cells('table:number-columns-repeated="5"')}</table:table-row></table:table>`;
    const wb = await workbookFromFile(file(mode, tables), `defaults.${mode}`);
    for (const back of [wb, await workbookFromFile(await workbookToXlsx(wb), 'saved.xlsx')]) {
      const id = back.activeSheetId;
      const expected = [
        ['7.500', '7.500', '7.500', '7.500', '7.500'],
        ['7.5', '7.50', '7.50', '7.5', '7.500'],
        ['7.5', '7.50', '7.50', '7.5', '7.500'],
        ['7.50', '7.500', '7.5', '7.5', '7.5'],
      ];
      for (let r = 0; r < expected.length; ++r) for (let c = 0; c < 5; ++c) {
        expect(back.getValue(id, r, c)).toBe(7.5);
        expect(back.getDisplay(id, r, c)).toBe(expected[r][c]);
      }
      expect(back.getDisplay(id, 4, 4)).toBe('7.500');
      const next = back.sheets.find((sheet) => sheet.name === 'Next').id;
      for (let c = 0; c < 5; ++c) expect(back.getDisplay(next, 0, c)).toBe('7.5');
    }
  },
);

it.each(modes.flatMap((mode) => [false, true].flatMap((dense) => [false, true].map((cellDates) => ({ mode, dense, cellDates })))))(
  'formats repeated numeric cells independently across date and number columns: %j', ({ mode, dense, cellDates }) => {
    const tables = `<table:table table:name="Data">${column('date')}${column('s2')}${column('date')}
      <table:table-row table:number-rows-repeated="2">${cell('table:number-columns-repeated="3"', true, 45306.5)}</table:table-row></table:table>`;
    const raw = XLSX.read(file(mode, tables), { type: 'array', dense, cellDates, cellNF: true });
    const ws = raw.Sheets.Data;
    for (let r = 0; r < 2; ++r) for (let c = 0; c < 3; ++c) {
      const q = dense ? ws['!data'][r][c] : ws[XLSX.utils.encode_cell({ r, c })];
      expect(q.z).toBe(c === 1 ? '0.00' : 'yyyy"-"mm"-"dd');
      if (c !== 1 && cellDates) {
        expect(q.t).toBe('d');
        expect(q.v.toISOString()).toBe('2024-01-15T12:00:00.000Z');
      } else {
        expect(q.t).toBe('n');
        expect(q.v).toBe(45306.5);
      }
    }
  },
);

it.each(modes)('keeps full-width blank columns sparse in %s', async (mode) => {
  const tables = `<table:table table:name="Data">${column('s2', 16384)}<table:table-row>
    <table:table-cell table:number-columns-repeated="16383"/>${cell()}</table:table-row></table:table>`;
  const data = file(mode, tables);
  const raw = XLSX.read(data, { type: 'array' });
  expect(Object.keys(raw.Sheets.Data).filter((key) => !key.startsWith('!'))).toEqual(['XFD1']);
  const wb = await workbookFromFile(data, `wide.${mode}`);
  expect(wb.getDisplay(wb.activeSheetId, 0, 16383)).toBe('7.50');
});

it.each(['0', '-1', '1.5', '16385', '9'.repeat(310)])('rejects invalid column declaration repeats: %s', (repeat) => {
  const tables = `<table:table table:name="Data">${column('s2', repeat)}<table:table-row>${cell()}</table:table-row></table:table>`;
  expect(() => XLSX.read(file('fods', tables), { type: 'array' })).toThrow(/ODS column repeat/);
});
