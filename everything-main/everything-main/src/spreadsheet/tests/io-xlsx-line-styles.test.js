import { DEFAULT_FONT_COLOR } from '../src/core/font-color.js';
import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { readXlsxLineStyles } from '../src/core/xlsx-line-styles.js';
import { Workbook } from '../src/core/workbook.js';
import { otherProgramsXlsx } from './helpers/xlsx-fixture.js';

const styles = {
  fonts: ['<font><b/><sz val="16"/><color rgb="FFFF0000"/><name val="Arial"/></font>', '<font><i/><sz val="12"/><color rgb="FF008000"/><name val="Courier New"/></font>'],
  fills: ['<fill><patternFill patternType="solid"><fgColor rgb="FFFFFF00"/></patternFill></fill>'],
  cellXfs: ['<xf numFmtId="4" fontId="1" fillId="2" borderId="0" xfId="0"/>', '<xf numFmtId="9" fontId="2" fillId="0" borderId="0" xfId="0"/>'],
};
const fixture = () => otherProgramsXlsx({ styles, sheetXml: { Data: {
  head: '<cols><col min="1" max="3" width="18" style="1"/></cols>',
  rows: '<row r="1"><c r="A1"><v>123</v></c><c r="B1" s="0"><v>123</v></c><c r="C1" s="2"><v>123</v></c></row>'
    + '<row r="2" s="2" customFormat="1"><c r="A2"><v>123</v></c><c r="B2" s="0"/></row>'
    + '<row r="3" s="2"><c r="A3"><v>123</v></c></row><row r="4" s="2" customFormat="0"/>',
} } });
const effective = (wb, r, c) => wb.styleAt(wb.activeSheetId, r, c);
function check(wb) {
  expect(effective(wb, 8, 0)).toMatchObject({ font: 'arial', size: 64 / 3, bold: true, color: '#ff0000', bg: '#ffff00', fmt: 'number', dec: 2 });
  expect(effective(wb, 1, 2)).toMatchObject({ font: 'courier', italic: true, color: '#008000', fmt: 'percent' });
  expect(effective(wb, 1, 2).bold).toBeFalsy(); expect(effective(wb, 1, 2).bg).toBeFalsy();
  for (const [r,c] of [[0,0],[0,1],[1,0],[1,1]]) {
    expect(effective(wb,r,c)).toMatchObject({ font: 'calibri', size: 16, color: DEFAULT_FONT_COLOR });
    expect(effective(wb,r,c).bold).toBeFalsy(); expect(effective(wb,r,c).italic).toBeFalsy();
    expect(effective(wb,r,c).bg).toBeFalsy(); expect(effective(wb,r,c).fmt || 'general').toBe('general');
  }
  expect(effective(wb,0,2)).toMatchObject({ font:'courier', italic:true, fmt:'percent' });
  expect(effective(wb,0,2).bold).toBeFalsy();
  // Excel ignores s on a row unless customFormat is true.
  expect(effective(wb,2,1).font).toBe('arial'); expect(effective(wb,3,1).font).toBe('arial');
  expect(wb.activeSheet.cells.size).toBeLessThan(12);
}
it('imports row/column defaults, with complete cell formats and explicit blank resets', async () => {
  const wb = await workbookFromFile(fixture(), 'external.xlsx'); check(wb);
  wb.setInput(wb.activeSheetId, 8, 0, '4');
  expect(effective(wb,8,0).font).toBe('arial');
  wb.setInput(wb.activeSheetId,1,2,'5'); expect(effective(wb,1,2).fmt).toBe('percent');
  const copied = wb.copyRange(wb.activeSheetId,{r1:7,c1:0,r2:8,c2:0});
  wb.pasteCells(wb.activeSheetId,copied,7,5,{r:7,c:0});
  expect(effective(wb,7,5)).toMatchObject({font:'arial',bold:true,bg:'#ffff00'});
  wb.undo(); wb.redo(); expect(effective(wb,8,5).font).toBe('arial');
});
it('preserves line formats through app and native-only XLSX round trips', async () => {
  const wb = await workbookFromFile(fixture(), 'external.xlsx');
  const bytes = new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer());
  check(await workbookFromFile(bytes,'saved.xlsx'));
  const zip=X.CFB.read(bytes,{type:'array'}),part=X.CFB.find(zip,'/xl/workbook.xml');
  part.content=new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g,''));part.size=part.content.length;
  check(await workbookFromFile(X.CFB.write(zip,{type:'array',fileType:'zip'}),'native.xlsx'));
});
it('bounds native line declarations and ignores comments, invalid styles and disabled row formats',()=>{
  const {cols,rows}=readXlsxLineStyles('<worksheet><cols><!-- <col min="1" max="1" style="1"/> --><col min="2" max="16384" style="1"/><col min="0" max="3" style="1"/><col min="1" max="999999999" style="1"/><col min="1" max="1" style="99"/></cols><sheetData><row r="1048576" s="2" customFormat="true"/><row r="0" s="1" customFormat="1"/><row r="999999999" s="1" customFormat="1"/></sheetData></worksheet>',[{}, {font:'arial',bold:true},{font:'courier',italic:true}]);
  expect(Object.keys(cols)).toHaveLength(16383);expect(Object.keys(rows)).toHaveLength(1);
  expect(rows[1048575]).toMatchObject({font:'courier',italic:true,bold:null});
});
it('reads custom number formats used only by line defaults and keeps the Normal font distinct', async () => {
  const bytes = otherProgramsXlsx({ styles: {
    ...styles, numFmts: ['<numFmt numFmtId="171" formatCode="0.0000&quot; units&quot;"/>'],
    cellXfs: [...styles.cellXfs, '<xf numFmtId="171" fontId="1" fillId="0" borderId="0" xfId="0"/>'],
  }, sheetXml: { Data: { head: '<cols><col min="4" max="4" style="3"/></cols>', rows: '<row r="7" s="0" customFormat="1"/>' } } });
  const wb = await workbookFromFile(bytes,'line-only.xlsx');
  expect(effective(wb,0,3)).toMatchObject({font:'arial',fmt:'custom',code:'0.0000" units"'});
  expect(effective(wb,6,3)).toMatchObject({font:'calibri',size:16});
  expect(effective(wb,6,3).fmt || 'general').toBe('general');
  expect(wb.normalStyle.font).toBe('calibri');
  wb.setInput(wb.activeSheetId,0,3,'1.25'); expect(wb.getDisplay(wb.activeSheetId,0,3)).toBe('1.2500 units');
});

it.each(['row', 'column', 'both'])('keeps %s formats on hyperlink-only cells without confusing them with stored XF-zero cells', async kind => {
  const sheet = {
    head: kind === 'row' ? '' : '<cols><col min="2" max="4" width="18" style="2"/></cols>',
    rows: `<row r="1"${kind === 'column' ? '' : ' s="1" customFormat="1"'}><c r="A1"><v>7</v></c><c r="C1"/></row>`
      + '<row r="2"><c r="C2" s="0"/></row>',
  };
  const control = await workbookFromFile(otherProgramsXlsx({ styles, sheetXml: { Data: sheet } }));
  let wb = await workbookFromFile(otherProgramsXlsx({ styles, sheetXml: { Data: { ...sheet,
    tail: '<hyperlinks><hyperlink ref="B1:D2" location="Data!A1"/></hyperlinks>',
  } } }));
  const keys = ['font', 'size', 'color', 'bg', 'bold', 'italic', 'fmt', 'dec'];
  const projection = (book, r, c) => Object.fromEntries(keys.map(k => [k,
    ['bold', 'italic'].includes(k) ? !!effective(book, r, c)[k] : effective(book, r, c)[k] ?? null]));
  for (let pass = 0; pass < 3; pass++) {
    for (let r = 0; r < 2; r++) for (let c = 1; c <= 3; c++) {
      expect(wb.linkAt(wb.activeSheetId, r, c)?.url).toBe('#Data!A1');
      expect(projection(wb, r, c)).toEqual(projection(control, r, c));
    }
    if (pass === 2) break;
    const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
    const part = X.CFB.find(zip, '/xl/workbook.xml');
    // One cycle exercises private metadata; the second is native-only.
    if (pass === 1) X.CFB.utils.cfb_add(zip, '/xl/workbook.xml', new TextEncoder().encode(new TextDecoder().decode(part.content)
      .replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, '')));
    wb = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }));
  }
  const clip = wb.copyRange(wb.activeSheetId, { r1: 0, c1: 1, r2: 0, c2: 1 });
  wb.pasteCells(wb.activeSheetId, clip, 5, 5, { r: 0, c: 1 });
  expect(projection(wb, 5, 5)).toEqual(projection(control, 0, 1));
  expect(wb.linkAt(wb.activeSheetId, 5, 5)?.url).toBe('#Data!A1');
});

it('inherits reconciled row formats when an external application adds a hyperlink to an unallocated cell', async () => {
  const wb = new Workbook({ sheets: [{ name: 'Data', rowStyles: { 2: { bg: '#123456', bold: true } }, cells: { '0,0': { v: 2 } } }] });
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
  const part = X.CFB.find(zip, '/xl/worksheets/sheet1.xml');
  X.CFB.utils.cfb_add(zip, '/xl/worksheets/sheet1.xml', new TextEncoder().encode(new TextDecoder().decode(part.content)
    .replace('</worksheet>', '<hyperlinks><hyperlink ref="B3" location="Data!A1"/></hyperlinks></worksheet>')));
  const back = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }));
  expect(back.linkAt(back.activeSheetId, 2, 1)?.url).toBe('#Data!A1');
  expect(effective(back, 2, 1)).toMatchObject({ bg: '#123456', bold: true });
  expect(back.getCell(back.activeSheetId, 2, 1).s).toBeUndefined();
});
