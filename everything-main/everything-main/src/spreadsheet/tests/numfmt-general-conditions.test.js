// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { formatWithCode, codeColor, codeDateKind } from '../src/core/numfmt.js';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { cellsToHtml, parseHtmlClipboard, cellsFromHtmlRows } from '../src/core/clipboard.js';
import * as X from '../src/vendor/xlsx.mjs';
import { calc } from './helpers/calc.js';
import native from './fixtures/reference-general-conditions.json';

it('matches native conditional General, directive, sign and rounded-zero results', () => {
  for (const [value, code, expected] of native.cases) {
    expect(formatWithCode(value, code, {textFunction:true}), `${value}: ${code}`).toBe(expected?.error ? '#####' : expected);
    const literal = typeof value === 'string' ? `"${value.replaceAll('"','""')}"` : String(value);
    expect(calc(`TEXT(${literal},"${code.replaceAll('"','""')}")`), `${value}: ${code}`).toEqual(expected);
  }
});

it('distinguishes a lone General field from decorated and multiple sections', () => {
  expect(formatWithCode(-5, '[<0]General')).toBe('-5');
  expect(formatWithCode(5, '[<0]General')).toBe('#####');
  expect(formatWithCode(-5, '[<0]General""')).toBe('5');
  expect(formatWithCode(5, '[<0]General""')).toBe('5');
  expect(formatWithCode(-5, 'General;General')).toBe('5');
  expect(formatWithCode(-5, '[<0][$$-409]General')).toBe('$5');
  expect(formatWithCode(-.1, '[<=0]0;General')).toBe('0.1');
  expect(formatWithCode(-.1, '[<=0]# ?/?;General')).toBe('-0    ');
  expect(codeColor(-5, '[Blue];[Red]')).toBe('#ff0000');
  expect(codeColor(-.1, '[Red][<=0]0;[Blue]General')).toBe('#0000ff');
  expect(codeColor(-.1, '[Red][<=0]?/?;[Blue]General')).toBe('#0000ff');
  expect(codeColor(-.1, '[Red][<=0]# ?/?;[Blue]General')).toBe('#ff0000');
  // The section is reselected before a system pattern is substituted, and the
  // newly selected clock section reads the original positive magnitude.
  for (const [code, expected] of [
    ['[<=0][$-F800]0;General','0.1'], ['[<=0][$-F400]0;General','0.1'],
    ['[<=0]0;hh:mm','02:24'], ['[<=0]?/?;hh:mm','02:24'],
  ]) {
    expect(formatWithCode(-.1,code)).toBe(expected);
    expect(calc(`TEXT(-0.1,"${code}")`)).toBe(expected);
  }
  expect(codeDateKind(-.1,'[<=0]0;hh:mm')).toBe('time');
});

it('preserves General signs and conditions through edit/undo, HTML and metadata-free XLSX', async () => {
  const cases=[[-5,'General;General','5'],[-5,'[<0]General','-5'],[5,'[<0]General','#####'],[-.1,'[<=0]0;General','0.1'],[-5,'[<0][$$-409]General','$5']];
  const wb=new Workbook(), id=wb.activeSheetId;
  for(const [r,[value,code,display]] of cases.entries()) {
    wb.setInput(id,r,0,String(value));
    wb.applyStyle(id,{r1:r,r2:r,c1:0,c2:0},{fmt:'custom',code});
    wb.setInput(id,r,1,`=A${r+1}*2`);
    expect(wb.getDisplay(id,r,0)).toBe(display);
    const html=cellsToHtml([[display]],[[wb.getCell(id,r,0)]],null,[[value]]).replace(/ data-spreadsheet-[\w-]+="[^"]*"/g,'');
    const cell=cellsFromHtmlRows(parseHtmlClipboard(html).rows)[0].cell;
    expect(cell.v).toBe(value); expect(cell.s.code).toBe(code);
  }
  wb.setInput(id,1,0,'5'); expect(wb.getDisplay(id,1,0)).toBe('#####');
  wb.undo(); expect(wb.getDisplay(id,1,0)).toBe('-5');
  const blob=await workbookToXlsx(wb);
  const bytes=await new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(new Uint8Array(reader.result));reader.readAsArrayBuffer(blob);});
  const zip=X.CFB.read(bytes,{type:'array'}),part=X.CFB.find(zip,'/xl/workbook.xml');
  part.content=new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g,''));part.size=part.content.length;
  const restored=await workbookFromFile(X.CFB.write(zip,{type:'array',fileType:'zip'}),'general.xlsx');
  for(const [r,[value,code,display]] of cases.entries()){
    expect(restored.getValue(restored.activeSheetId,r,0)).toBe(value);
    expect(restored.styleAt(restored.activeSheetId,r,0).code).toBe(code);
    expect(restored.getDisplay(restored.activeSheetId,r,0)).toBe(display);
    expect(restored.getValue(restored.activeSheetId,r,1)).toBe(value*2);
  }
});
