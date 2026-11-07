import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToOds, workbookToXlsx } from '../src/core/io.js';
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
function file(cells, format = 'fods', before = '') {
  const tag = format === 'ods' ? 'document-content' : 'document';
  const xml = `<?xml version="1.0"?><office:${tag} xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:of="urn:oasis:names:tc:opendocument:xmlns:of:1.2" office:version="1.2" office:mimetype="application/vnd.oasis.opendocument.spreadsheet"><office:body><office:spreadsheet>${before}<table:table table:name="Data"><table:table-column/><table:table-row>${cells}</table:table-row></table:table></office:spreadsheet></office:${tag}>`;
  let bytes = new TextEncoder().encode(xml);
  if (format === 'ods') {
    const base = X.utils.book_new(); X.utils.book_append_sheet(base, X.utils.aoa_to_sheet([[0]]), 'Data');
    const zip = X.CFB.read(new Uint8Array(X.write(base, { type: 'array', bookType: 'ods' })), { type: 'array' });
    X.CFB.utils.cfb_add(zip, 'content.xml', bytes); bytes = X.CFB.write(zip, { type: 'array', fileType: 'zip' });
  }
  return bytes;
}
const textCell = text => `<table:table-cell office:value-type="string"><text:p>${text}</text:p></table:table-cell>`;
it.each(['ods', 'fods'].flatMap(format => ['_x0041_', '_X0041_', '_x005f_x0041_', '_x0000_', '_xD83D__xDE00_', '& <tag> "😀" _x0041_'].map(value => ({ format, value }))))('keeps literal $value in $format text', async ({ format, value }) => {
  const wb = await workbookFromFile(file(textCell(escape(value)), format), `text.${format}`);
  expect(wb.getValue(wb.activeSheetId, 0, 0)).toBe(value);
});
it.each(['ods', 'fods'])('preserves explicit string attributes and ignores displayed alternatives in %s', async format => {
  const wb = await workbookFromFile(file('<table:table-cell office:value-type="string" office:string-value="_x0041_ &amp; &#x1F600;"><text:p>Display</text:p></table:table-cell>', format), `text.${format}`);
  expect(wb.getValue(wb.activeSheetId, 0, 0)).toBe('_x0041_ & 😀');
});
it.each(['ods', 'fods'])('preserves literals in live formulas and their referenced text in %s', async format => {
  const cells = textCell('_x0041_') + '<table:table-cell office:value-type="string" table:formula="of:=IF([.A1]=&quot;_x0041_&quot;;&quot;_x0042_ &amp; 😀&quot;;&quot;other&quot;)"><text:p>cached</text:p></table:table-cell>';
  const wb = await workbookFromFile(file(cells, format), `formula.${format}`);
  expect(wb.getCell(wb.activeSheetId, 0, 1).f).toContain('"_x0041_"');
  expect(wb.getValue(wb.activeSheetId, 0, 1)).toBe('_x0042_ & 😀');
  wb.setInput(wb.activeSheetId, 0, 0, 'changed'); expect(wb.getValue(wb.activeSheetId, 0, 1)).toBe('other');
});
it.each(['ods', 'fods'])('preserves links, rich text, whitespace and annotation text in %s', async format => {
  const target = 'https://example.com/_x0041_?a=1&b=2';
  const cells = `<table:table-cell office:value-type="string"><text:p><text:a xlink:href="${escape(target)}"><text:span>_x0041_</text:span><text:s text:c="2"/>and<text:tab/>_x0042_<text:line-break/>end</text:a></text:p><office:annotation><text:p>Note _x0043_ &amp; &#65;</text:p></office:annotation></table:table-cell>`;
  const bytes = file(cells, format), raw = X.read(bytes, { type: 'array' });
  expect(raw.Sheets.Data.A1.l.Target).toBe(target);
  expect(raw.Sheets.Data.A1.c[0].t).toBe('Note _x0043_ & A');
  const wb = await workbookFromFile(bytes, `links.${format}`);
  expect(wb.getValue(wb.activeSheetId, 0, 0)).toBe('_x0041_  and\t_x0042_\nend');
});
it.each(['ods', 'fods'])('preserves validation prompts and errors in %s', async format => {
  const rules = '<table:content-validations><table:content-validation table:name="Rule" table:condition="of:cell-content-is-in-list(&quot;_x0041_&quot;)" table:base-cell-address="$Data.$A$1"><table:help-message table:display="true"><text:p>Choose _x0041_</text:p></table:help-message><table:error-message table:display="true" table:message-type="stop"><text:p>Expected _x0041_ &amp; nothing else</text:p></table:error-message></table:content-validation></table:content-validations>';
  const wb = await workbookFromFile(file('<table:table-cell table:content-validation-name="Rule"/>', format, rules), `validation.${format}`);
  expect(wb.validationAt(wb.activeSheetId, 0, 0)).toMatchObject({ prompt: 'Choose _x0041_', message: 'Expected _x0041_ & nothing else' });
});
it('preserves selected literal values, formulas and notes over ODS and XLSX saves', async () => {
  let wb = new Workbook(), id = wb.activeSheetId;
  wb.setInput(id, 0, 0, 'Value'); wb.setInput(id, 1, 0, '_x0041_'); wb.setInput(id, 2, 0, 'Other');
  wb.setInput(id, 0, 1, '="_x0042_"'); wb.setNote(id, 1, 0, 'Note _x0043_');
  wb.setFilterRange(id, { r1: 0, c1: 0, r2: 2, c2: 0 }); wb.setFilterCriteria(id, 0, { values: ['_x0041_'] });
  for (const [exporter, filename] of [[workbookToOds, 'one.ods'], [workbookToOds, 'two.ods']]) {
    wb = await workbookFromFile(await exporter(wb), filename); id = wb.activeSheetId;
    expect(wb.getValue(id, 1, 0)).toBe('_x0041_'); expect(wb.getValue(id, 0, 1)).toBe('_x0042_');
    expect(wb.activeSheet.notes.get('1,0')).toBe('Note _x0043_'); expect([...wb.activeSheet.filterHidden]).toEqual([2]);
  }
  wb = await workbookFromFile(await workbookToXlsx(wb), 'three.xlsx');
  expect(wb.getValue(wb.activeSheetId, 1, 0)).toBe('_x0041_'); expect(wb.getValue(wb.activeSheetId, 0, 1)).toBe('_x0042_');
  expect([...wb.activeSheet.filterHidden]).toEqual([2]);
});
it('continues decoding XML character references once', async () => {
  const wb = await workbookFromFile(file(textCell('&#95;x0041_ &amp;#65; &#65; &#x1F600;')), 'entities.fods');
  expect(wb.getValue(wb.activeSheetId, 0, 0)).toBe('_x0041_ &#65; A 😀');
});
