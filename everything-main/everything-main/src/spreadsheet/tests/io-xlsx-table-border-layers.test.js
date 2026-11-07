// @vitest-environment jsdom
import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { readXlsxStyles } from '../src/core/xlsx-styles.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { cellsToHtml, parseHtmlClipboard, cellsFromHtmlRows } from '../src/core/clipboard.js';

const gray = { bs: 'thin', bc: '#d4d4d4' }, green = { bs: 'medium', bc: '#39c199' };
function book() {
  const xml = `<styleSheet><dxfs count="3"><dxf><border><top/><bottom/><horizontal style="thin"><color rgb="FFD4D4D4"/></horizontal><vertical style="thin"><color rgb="FFD4D4D4"/></vertical></border></dxf>
    <dxf><fill><patternFill patternType="solid"><bgColor rgb="FF87DBC2"/></patternFill></fill><border><left/><right/><top/><bottom/><horizontal/><vertical/></border></dxf>
    <dxf><fill><patternFill patternType="none"/></fill><border><bottom style="medium"><color rgb="FF39C199"/></bottom></border></dxf></dxfs>
    <tableStyles><tableStyle name="Travel"><tableStyleElement type="wholeTable" dxfId="0"/><tableStyleElement type="headerRow" dxfId="1"/><tableStyleElement type="totalRow" dxfId="2"/></tableStyle></tableStyles></styleSheet>`;
  const customStyle = readXlsxStyles({ files: { 'xl/styles.xml': { content: new TextEncoder().encode(xml) } } }).tables.get('Travel');
  return new Workbook({ sheets: [{ name: 'Travel', cells: { '0,0': { v: 'Item' }, '0,1': { v: 'Cost' }, '0,2': { v: 'Note' }, '1,1': { v: 12 }, '3,0': { v: 'Total' } },
    tables: [{ name: 'Costs', style: 'custom', customStyle, totalsRow: true, banded: true, range: { r1: 0, c1: 0, r2: 3, c2: 2 } }] }] });
}
const look = (wb, r, c) => wb.conditionalStyle(wb.activeSheetId, r, c, wb.getValue(wb.activeSheetId, r, c));
const expectBorders = wb => {
  expect(look(wb, 3, 1)).toMatchObject({ bg: 'transparent', bt: true, bb: true, bl: true, br: true, btBorder: gray, blBorder: gray, brBorder: gray, bbBorder: green });
  expect(look(wb, 0, 1)).toMatchObject({ bg: '#87dbc2', bt: false, bb: false, bl: false, br: false });
  expect(look(wb, 1, 1)).toMatchObject({ btBorder: gray, bbBorder: gray, blBorder: gray, brBorder: gray });
};

it('layers differential borders per side and preserves explicit fill and border clears', () => {
  const wb = book();
  expectBorders(wb);
  expectBorders(new Workbook(wb.toJSON()));
  wb.setInput(wb.activeSheetId, 1, 1, '20');
  expectBorders(wb);
  wb.undo();
  expect(wb.getValue(wb.activeSheetId, 1, 1)).toBe(12);
  expectBorders(wb);
  wb.applyBorders(wb.activeSheetId, { r1: 3, c1: 1, r2: 3, c2: 1 }, 'bottom', { style: 'dotted', color: '#123456' });
  expect(look(wb, 3, 1).bbBorder).toEqual({ bs: 'dotted', bc: '#123456' });
  expect(look(wb, 3, 1).btBorder).toEqual(gray);
  expect(look(wb, 3, 0).bbBorder).toEqual(green);
  wb.undo();
  expectBorders(wb);
});

it('updates cached table coats when rows are hidden and undo restores their stripe positions', () => {
  const json = book().toJSON();
  Object.assign(json.sheets[0].tables[0].customStyle, { firstRowStripe: { bg: '#ffeeaa' }, secondRowStripe: { bg: '#eeddee' } });
  const wb = new Workbook(json);
  expect(look(wb, 1, 1).bg).toBe('#ffeeaa');
  expect(look(wb, 2, 1).bg).toBe('#eeddee');
  wb.setHidden(wb.activeSheetId, 'row', [1], true);
  expect(look(wb, 2, 1).bg).toBe('#ffeeaa');
  expect(look(wb, 3, 1).bbBorder).toEqual(green);
  wb.undo();
  expect(look(wb, 2, 1).bg).toBe('#eeddee');
});

it('exports native differential edge colors and clears without depending on private metadata', async () => {
  let wb = book();
  for (let pass = 0; pass < 2; pass++) {
    const blob = await workbookToXlsx(wb);
    const bytes = await new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsArrayBuffer(blob); });
    const zip = X.CFB.read(new Uint8Array(bytes), { type: 'array' });
    const part = X.CFB.find(zip, '/xl/workbook.xml');
    part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
    part.size = part.content.length;
    wb = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'external.xlsx');
    expectBorders(wb);
  }
});

it('copies the displayed table borders to external HTML and reads them back', () => {
  const wb = book(), cell = wb.getCell(wb.activeSheetId, 3, 1);
  const html = cellsToHtml([['12']], [[cell]], [[look(wb, 3, 1)]]);
  expect(html).toContain('border-bottom:1pt solid #39c199');
  expect(html).toContain('border-top:0.5pt solid #d4d4d4');
  const rows = parseHtmlClipboard(html.replace(/ data-spreadsheet-\w+="[^"]*"/g, '')).rows;
  expect(rows[0][0].style).toMatchObject({ btBorder: gray, blBorder: gray, brBorder: gray, bbBorder: green });
});

it('reads Excel border classes, physical widths, side overrides and clears', () => {
  const html = `<style>.xl1 {border:.5pt solid windowtext;border-bottom:2pt solid #39c199;}</style><table><tr>
    <td class="xl1" style="border-left:none;border-right:3px double red">12</td></tr></table>`;
  const rows = parseHtmlClipboard(html).rows;
  expect(rows[0][0].style).toMatchObject({ bt: true, bb: true, br: true, bl: false, blBorder: null,
    btBorder: { bs: 'thin', bc: '#000000' }, bbBorder: green, brBorder: { bs: 'double', bc: '#ff0000' } });
  const pasted = cellsFromHtmlRows(rows, () => ({ bl: true, blBorder: { bs: 'thick', bc: '#0000ff' } }));
  expect(pasted[0].cell.s.bl).toBe(false);
  expect(pasted[0].cell.s.blBorder).toBeNull();
});

it('settles repeated shorthands and per-side longhands in their actual order', () => {
  const html = '<table><tr><td style="border:1px solid red;border-left:3px double blue;border:2px solid green;border-top-color:#123456;border-bottom-style:dotted">x</td></tr></table>';
  const style = parseHtmlClipboard(html).rows[0][0].style;
  expect(style.blBorder).toEqual({ bs: 'medium', bc: '#008000' });
  expect(style.btBorder).toEqual({ bs: 'medium', bc: '#123456' });
  expect(style.bbBorder).toEqual({ bs: 'dotted', bc: '#008000' });
});

it('preserves invisible borders and uses the text color for currentColor borders', () => {
  const html = '<table><tr><td style="color:#123456;border:1px solid currentColor;border-left-color:transparent;border-top-color:rgba(0,0,0,0)">x</td></tr></table>';
  const style = parseHtmlClipboard(html).rows[0][0].style;
  expect(style).toMatchObject({ bl: false, bt: false, br: true, bb: true, brBorder: { bs: 'thin', bc: '#123456' } });
});

it.each(['#aa0000', '#008800', 'rgb(170, 0, 0)', 'hsl(0, 100%, 0%)'])('keeps opaque borders whose last color component is zero (%s)', color => {
  const style = parseHtmlClipboard(`<table><tr><td style="border-right:1px solid ${color}">x</td></tr></table>`).rows[0][0].style;
  expect(style.br).toBe(true);
  expect(style.brBorder.bs).toBe('thin');
});
it.each(['rgba(170, 0, 1, 0)', 'hsla(0, 100%, 50%, 0)', 'transparent'])('preserves truly transparent border clears (%s)', color => {
  const style = parseHtmlClipboard(`<table><tr><td style="border-right:1px solid ${color}">x</td></tr></table>`).rows[0][0].style;
  expect(style.br).toBe(false);
  expect(style.brBorder).toBeNull();
});
