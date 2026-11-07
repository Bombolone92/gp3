import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToOds, workbookToXlsx } from '../src/core/io.js';

function monthFile(textual, width) {
  const attr = textual == null ? '' : ` number:textual="${textual}"`;
  const month = `<number:month number:style="${width}"${attr}/>`;
  return new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8"?>
<office:document xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
 xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"
 xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"
 xmlns:number="urn:oasis:names:tc:opendocument:xmlns:datastyle:1.0"
 xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"
 office:version="1.2" office:mimetype="application/vnd.oasis.opendocument.spreadsheet">
 <office:automatic-styles>
  <number:date-style style:name="N1">${month}</number:date-style>
  <number:date-style style:name="N2"><number:year number:style="long"/><number:text>-</number:text>${month}<number:text>-</number:text><number:day number:style="long"/></number:date-style>
  <style:style style:name="ce1" style:family="table-cell" style:data-style-name="N1"/>
  <style:style style:name="ce2" style:family="table-cell" style:data-style-name="N2"/>
 </office:automatic-styles>
 <office:body><office:spreadsheet><table:table table:name="Data"><table:table-row>
  <table:table-cell table:style-name="ce1" office:value-type="date" office:date-value="2024-01-15"><text:p>cached month</text:p></table:table-cell>
  <table:table-cell table:style-name="ce2" office:value-type="date" office:date-value="2024-01-15"><text:p>cached date</text:p></table:table-cell>
 </table:table-row></table:table></office:spreadsheet></office:body>
</office:document>`);
}

it.each([undefined, 'false', '0', 'true', '1'].flatMap((textual) =>
  ['short', 'long'].map((width) => ({ textual, width })),
))('imports number:textual=$textual with $width month width', async ({ textual, width }) => {
  const named = textual === 'true' || textual === '1';
  const month = named ? (width === 'long' ? 'January' : 'Jan') : (width === 'long' ? '01' : '1');
  const wb = await workbookFromFile(monthFile(textual, width), 'months.fods');
  const saved = await workbookFromFile(await workbookToXlsx(wb), 'saved.xlsx');
  for (const back of [wb, saved]) {
    expect(back.getValue(back.activeSheetId, 0, 0)).toBe(45306);
    expect(back.getValue(back.activeSheetId, 0, 1)).toBe(45306);
    expect(back.getDisplay(back.activeSheetId, 0, 0)).toBe(month);
    expect(back.getDisplay(back.activeSheetId, 0, 1)).toBe(`2024-${month}-15`);
  }
});

it.each([['m', '1'], ['mm', '01'], ['mmm', 'Jan'], ['mmmm', 'January']])(
  'keeps %s months through an ODS save and reopen', async (code, expected) => {
    const wb = new Workbook();
    wb.setCells(wb.activeSheetId, [{ r: 0, c: 0, cell: { v: 45306, s: { fmt: 'custom', code } } }]);
    const back = await workbookFromFile(await workbookToOds(wb), 'months.ods');
    expect(back.getValue(back.activeSheetId, 0, 0)).toBe(45306);
    expect(back.getDisplay(back.activeSheetId, 0, 0)).toBe(expected);
  },
);
