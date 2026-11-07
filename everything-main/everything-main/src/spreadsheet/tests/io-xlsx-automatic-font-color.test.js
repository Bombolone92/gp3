// @vitest-environment jsdom
import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { parseRange } from '../src/core/cell.js';
import { readXlsxStyles, xlsxAttr, xlsxElements } from '../src/core/xlsx-styles.js';
import { otherProgramsXlsx } from './helpers/xlsx-fixture.js';
import { cellsToHtml, parseHtmlClipboard } from '../src/core/clipboard.js';

const bytes = async wb => {
  const blob = await workbookToXlsx(wb);
  return new Uint8Array(await new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error); reader.readAsArrayBuffer(blob);
  }));
};
function edit(data, transform, nativeOnly = false) {
  const zip = X.CFB.read(data, { type: 'array' });
  for (const path of ['/xl/styles.xml', ...(nativeOnly ? ['/xl/workbook.xml'] : [])]) {
    const part = X.CFB.find(zip, path), xml = new TextDecoder().decode(part.content);
    const changed = path.endsWith('styles.xml') ? transform(xml) : xml.replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, '');
    X.CFB.utils.cfb_add(zip, path, new TextEncoder().encode(changed));
  }
  return X.CFB.write(zip, { type: 'array', fileType: 'zip' });
}
const read = data => workbookFromFile(data, 'colors.xlsx');
const colorAt = (wb, r = 0, c = 0) => wb.styleAt(wb.activeSheetId, r, c).color;

it.each(['', '<color auto="1"/>', '<color auto="true"/>'])('preserves automatic font color separately from RGB and theme black (%s)', async color => {
  const fonts = [color, '<color rgb="FF000000"/>', '<color theme="1"/>', '<color rgb="FF3276AB" auto="0"/>'];
  const wb = await read(otherProgramsXlsx({ styles: {
    fonts: fonts.map(c => `<font><b/><sz val="11"/>${c}<name val="Arial"/></font>`),
    cellXfs: fonts.map((_, i) => `<xf numFmtId="0" fontId="${i+1}" fillId="0" borderId="0" xfId="0" applyFont="1"/>`),
  }, sheetXml: { Data: { rows: '<row r="1">'+fonts.map((_,i)=>`<c r="${'ABCD'[i]}1" s="${i+1}" t="inlineStr"><is><t>Header</t></is></c>`).join('')+'</row>' } } }));
  expect(fonts.map((_,i)=>colorAt(wb,0,i))).toEqual(['windowtext','#000000',{theme:1,base:'#000000',rgb:'#000000'},'#3276ab']);
  const saved = await bytes(wb);
  for (const nativeOnly of [false,true]) {
    const back = await read(edit(saved, xml=>xml, nativeOnly));
    expect(fonts.map((_,i)=>colorAt(back,0,i))).toEqual(['windowtext','#000000',{theme:1,base:'#000000',rgb:'#000000'},'#3276ab']);
  }
  const zip = X.CFB.read(saved,{type:'array'});
  const styles = new TextDecoder().decode(X.CFB.find(zip,'/xl/styles.xml').content);
  const records = xlsxElements(xlsxElements(styles,'fonts')[0],'font');
  expect(records.some(font=>xlsxAttr(xlsxElements(font,'color')[0],'auto')==='1')).toBe(true);
});

it.each([['#000000','windowtext'],['windowtext','#000000']])('accepts native color edits from %s to %s despite identical usual appearance', async (before,after) => {
  const wb = new Workbook({ sheets: [{ cells: { '0,0': { v: 'Heading', s: { color: before, bold: true } } } }] });
  const changed = edit(await bytes(wb), xml => xml.replace(/<font>[\s\S]*?<\/font>/g, font => {
    if (!font.includes('<b/>')) return font;
    return font.replace(/<color\b[^>]*\/>/, after === 'windowtext' ? '<color auto="1"/>' : '<color rgb="FF000000"/>');
  }));
  const back = await read(changed);
  expect(colorAt(back)).toBe(after);
  expect(colorAt(await read(await bytes(back)))).toBe(after);
});

it('retains automatic Normal, row and cell colors through edits, undo, copies and native exports', async () => {
  const wb = new Workbook({ normalFont: { name:'Arial',sz:11,color:'windowtext' }, sheets: [{
    colStyles: { 0:{color:'#326789'} }, rowStyles: { 2:{color:'windowtext'} },
    cells: { '0,0':{v:'Explicit',s:{color:'windowtext'}}, '1,1':{v:'RGB',s:{color:'#000000'}}, '2,0':{v:'Row'}, '3,1':{v:'Normal'} },
  }] });
  const id = wb.activeSheetId;
  wb.applyStyle(id,parseRange('A1'),{color:'#d54321'}); expect(colorAt(wb)).toBe('#d54321');
  wb.undo(); expect(colorAt(wb)).toBe('windowtext');
  wb.pasteCells(id,wb.copyRange(id,parseRange('A1')),5,2,{r:0,c:0});
  const restored = new Workbook(wb.toJSON());
  for (const back of [restored,await read(await bytes(wb)),await read(edit(await bytes(wb),xml=>xml,true))]) {
    expect(back.normalFont.color).toBe('windowtext');
    for (const [r,c] of [[0,0],[2,0],[3,1],[5,2],[80,3]]) expect(colorAt(back,r,c)).toBe('windowtext');
    expect(colorAt(back,1,1)).toBe('#000000');
    expect(colorAt(back,80,0)).toBe('#326789');
  }
});

it('preserves system font color in internal and Excel-compatible HTML clipboard data', () => {
  const cells = [[{v:'Automatic',f:null,s:{color:'windowtext'}},{v:'RGB',f:null,s:{color:'#000000'}}]];
  const html = cellsToHtml([['Automatic','RGB']],cells);
  expect(html).toContain('color:windowtext');
  expect(parseHtmlClipboard(html).cells[0].map(cell=>cell.s.color)).toEqual(['windowtext','#000000']);
  const external = '<table><tr><td style="color:WindowText">Automatic</td><td style="color:#000000">RGB</td><td style="color:CanvasText">System</td></tr></table>';
  expect(parseHtmlClipboard(external).rows[0].map(cell=>cell.style.color)).toEqual(['windowtext','#000000','windowtext']);
});

it('distinguishes automatic differential color from an omitted color and preserves table overrides', async () => {
  const xml = '<styleSheet><dxfs count="2"><dxf><font><b/><color auto="1"/></font></dxf><dxf><font><i/></font></dxf></dxfs></styleSheet>';
  const parsed = readXlsxStyles({ files: { 'xl/styles.xml': { content: new TextEncoder().encode(xml) } } });
  expect(parsed.dxfs[0]).toMatchObject({ color: 'windowtext', bold: true });
  expect(parsed.dxfs[1]).not.toHaveProperty('color');
  const wb = new Workbook({ sheets: [{ cells: {
    '0,0': { v: 'Automatic header', s: { color: 'windowtext' } },
    '0,1': { v: 'Table header' }, '1,0': { v: 'Body' },
  }, tables: [{ name: 'Items', style: 'custom', range: parseRange('A1:B4'),
    customStyle: { headerRow: { color: '#843721' }, wholeTable: { color: 'windowtext' } },
  }] }] });
  for (const back of [wb, await read(edit(await bytes(wb), xml => xml, true))]) {
    const look = (r, c) => back.conditionalStyle(back.activeSheetId, r, c, back.getValue(back.activeSheetId, r, c));
    expect(look(0, 0).color).toBe('windowtext');
    expect(back.activeSheet.tables[0].customStyle.headerRow.color).toBe('#843721');
    expect(look(1, 0).color).toBe('windowtext');
    expect(back.activeSheet.tables[0].customStyle.wholeTable.color).toBe('windowtext');
  }
});
