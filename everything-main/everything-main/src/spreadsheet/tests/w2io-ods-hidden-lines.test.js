import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToOds } from '../src/core/io.js';

async function contentXml(blob) {
  const zip = X.CFB.read(new Uint8Array(await blob.arrayBuffer()), { type: 'array' });
  return new TextDecoder().decode(X.CFB.find(zip, 'content.xml').content);
}
function table(xml, name) {
  const start = xml.indexOf(`<table:table table:name="${name}"`);
  return xml.slice(start, xml.indexOf('</table:table>', start));
}
/** The zero-based indices of the declared columns or rows that are collapsed, repeats expanded. */
function collapsed(xml, element) {
  const out = [];
  let index = 0;
  for (const tag of xml.match(new RegExp(`<table:${element}\\b[^>]*>`, 'g'))) {
    const repeat = Number(/table:number-(?:columns|rows)-repeated="(\d+)"/.exec(tag)?.[1] || 1);
    if (/table:visibility="collapse"/.test(tag)) for (let i = 0; i < repeat; i++) out.push(index + i);
    index += repeat;
  }
  return out;
}
function tableStyleDisplay(xml, name) {
  const style = /table:style-name="([^"]+)"/.exec(table(xml, name))[1];
  const declaration = new RegExp(`<style:style style:name="${style}" style:family="table"[^>]*>\\s*<style:table-properties[^>]*table:display="(true|false)"`).exec(xml);
  return declaration && declaration[1];
}

// The ODS writer declared widths and heights but never a hidden row or column, and every
// sheet used the one displayed table style, so other programs showed everything the app
// had hidden; only the app's own settings block carried it.
it('writes hidden rows, columns and sheets so other programs hide them too', async () => {
  const wb = new Workbook({ sheets: [{ name: 'Main' }, { name: 'Aux', hidden: true }, { name: 'Secret', hidden: true, veryHidden: true }] });
  const id = wb.sheets[0].id;
  wb.setInput(id, 0, 0, 'a');
  wb.setInput(id, 6, 6, 'g');
  wb.setHidden(id, 'row', [1, 3, 4], true);
  wb.setHidden(id, 'col', [1, 3, 4], true);
  wb.setColWidth(id, 3, 60);
  wb.setRowHeight(id, 3, 40);
  const blob = await workbookToOds(wb, { settings: false });
  const xml = await contentXml(blob);
  const main = table(xml, 'Main');
  expect(collapsed(main, 'table-column')).toEqual([1, 3, 4]);
  expect(collapsed(main, 'table-row')).toEqual([1, 3, 4]);
  // Columns without their own layout between the hidden ones still share one declaration.
  expect(main).toMatch(/<table:table-column table:number-columns-repeated="2"\/>/);
  expect(tableStyleDisplay(xml, 'Main')).toBe('true');
  expect(tableStyleDisplay(xml, 'Aux')).toBe('false');
  expect(tableStyleDisplay(xml, 'Secret')).toBe('false');

  const back = await workbookFromFile(blob, 'hidden.ods');
  // ODF has no very-hidden state, so without the settings block both come back plainly hidden.
  expect(back.sheets.map((s) => [s.name, s.hidden, s.veryHidden])).toEqual([['Main', false, false], ['Aux', true, false], ['Secret', true, false]]);
  expect(back.activeSheet.name).toBe('Main');
  const bid = back.activeSheetId;
  expect([...back.sheets[0].hiddenRows].sort()).toEqual([1, 3, 4]);
  expect([...back.sheets[0].hiddenCols].sort()).toEqual([1, 3, 4]);
  expect(back.isRowHidden(bid, 2)).toBe(false);
  // A hidden line reports no width or height; its own size is still stored for when it is shown again.
  expect(back.sheets[0].colWidths.get(3)).toBe(60);
  expect(back.sheets[0].rowHeights.get(3)).toBe(40);
  expect(back.getValue(bid, 6, 6)).toBe('g');
});

it('leaves the table style displayed when no sheet is hidden', async () => {
  const wb = new Workbook();
  wb.setInput(wb.activeSheetId, 0, 0, 'x');
  const xml = await contentXml(await workbookToOds(wb, { settings: false }));
  expect(xml).not.toContain('table:display="false"');
  expect(xml).not.toContain('table:visibility');
});

it('reads a sheet LibreOffice hid through its table style', async () => {
  const flat = `<?xml version="1.0" encoding="UTF-8"?>
<office:document xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" office:version="1.2" office:mimetype="application/vnd.oasis.opendocument.spreadsheet">
<office:automatic-styles>
<style:style style:name="ta1" style:family="table" style:master-page-name="Default"><style:table-properties table:display="true" style:writing-mode="lr-tb"/></style:style>
<style:style style:name="ta2" style:family="table" style:master-page-name="Default"><style:table-properties table:display="false" style:writing-mode="lr-tb"/></style:style>
</office:automatic-styles>
<office:body><office:spreadsheet>
<table:table table:name="Shown" table:style-name="ta1"><table:table-column/><table:table-row><table:table-cell table:formula="of:=[$Backing.A1]*2" office:value-type="float" office:value="42"><text:p>42</text:p></table:table-cell></table:table-row></table:table>
<table:table table:name="Backing" table:style-name="ta2"><table:table-column/><table:table-row><table:table-cell office:value-type="float" office:value="21"><text:p>21</text:p></table:table-cell></table:table-row></table:table>
</office:spreadsheet></office:body></office:document>`;
  expect(X.read(flat, { type: 'string' }).Workbook.Sheets).toEqual([{ name: 'Shown', Hidden: 0 }, { name: 'Backing', Hidden: 1 }]);
  const wb = await workbookFromFile(new TextEncoder().encode(flat), 'backing.fods');
  expect(wb.sheets.map((s) => [s.name, s.hidden])).toEqual([['Shown', false], ['Backing', true]]);
  expect(wb.getValue(wb.activeSheetId, 0, 0)).toBe(42);
});
