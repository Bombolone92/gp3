// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { formatWithCode } from '../src/core/numfmt.js';
import { ymdToSerial } from '../src/core/format.js';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { cellsToHtml, parseHtmlClipboard, cellsFromHtmlRows } from '../src/core/clipboard.js';
import * as X from '../src/vendor/xlsx.mjs';
import { calc } from './helpers/calc.js';
import native from './fixtures/reference-short-calendar-year.json';

it('matches native Taiwan conversion and shared short-year encoding across field widths and numeral systems', () => {
  for (const [value,code,expected] of native.cases) {
    expect(formatWithCode(value,code),`${value}: ${code}`).toBe(expected?.error ? '#####' : expected);
    expect(calc(`TEXT(${value},"${code.replaceAll('"','""')}")`),`${value}: ${code}`).toEqual(expected);
  }
});

it('separates full-year encoding, fixed-position Buddhist fields and the Taiwan conversion epoch', () => {
  for (const [year,text] of [[9,'09'],[10,'01'],[99,'09'],[100,'01'],[999,'09'],[1000,'1000']]) {
    const value=ymdToSerial(1911+year,10,18);
    expect(formatWithCode(value,'B2[$-40404]y yy yyyy e')).toBe(Array(4).fill(text).join(' '));
    expect(formatWithCode(ymdToSerial(2018+year,10,18),'B2[$-30411]bbbb')).toBe(text);
  }
  expect(formatWithCode(45583,'B2[$-40404]bb')).toBe('3\0');
  expect(formatWithCode(45583,'B2[$-30411]bb')).toBe('\0\0');
  expect(formatWithCode(45583,'B2bbbb[$-40404]')).toBe('06');
  expect(formatWithCode(45583,'B2[DBNum1][$-40404]yyyy')).toBe('十三');
  expect(formatWithCode(45583,'B2[$-2040404]yyyy')).toBe('٠١');
  expect(formatWithCode(45583,'[$-40404]B2yy e')).toBe('2024 2024');
  expect(formatWithCode(ymdToSerial(1911,12,31),'B2[$-40404]yyyy')).toBe('#####');
  expect(formatWithCode(ymdToSerial(1912,1,1),'B2[$-40404]yyyy')).toBe('01');
  expect(formatWithCode(1,'B2[$-40404][h]')).toBe('24');
});

it('retains year conversion through editing, typed HTML, XLSX and cached TEXT containing NUL', async () => {
  const examples=[[45583,'B2[$-40404]yyyy'],[ymdToSerial(2910,12,31),'B2[$-40404]yy e'],[45583,'B2[DBNum1][$-40404]yyyy'],[45583,'B2[$-2040404]yyyy'],[45583,'B2[$-40404]bb'],[45583,'B2[$-30411]bbbb']];
  const wb=new Workbook(),id=wb.activeSheetId;
  for(const[r,[value,code]]of examples.entries()) {
    wb.setInput(id,r,0,String(value));wb.applyStyle(id,{r1:r,c1:0,r2:r,c2:0},{fmt:'custom',code});
    wb.setInput(id,r,1,`=TEXT(A${r+1},"${code}")`);
    const html=cellsToHtml([[formatWithCode(value,code)]],[[wb.getCell(id,r,0)]],null,[[value]]).replace(/ data-spreadsheet-[\w-]+="[^"]*"/g,'');
    const cell=cellsFromHtmlRows(parseHtmlClipboard(html).rows)[0].cell;
    expect(cell.v).toBe(value);expect(cell.s.code).toBe(code);
  }
  wb.setInput(id,1,0,String(examples[1][0]+1));expect(wb.getValue(id,1,1)).toBe('1000 1000');
  wb.undo();expect(wb.getValue(id,1,1)).toBe('09 09');
  const blob=await workbookToXlsx(wb),bytes=await new Promise(resolve=>{const r=new FileReader();r.onload=()=>resolve(new Uint8Array(r.result));r.readAsArrayBuffer(blob);});
  const zip=X.CFB.read(bytes,{type:'array'}),part=X.CFB.find(zip,'/xl/workbook.xml');
  part.content=new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g,''));part.size=part.content.length;
  const back=await workbookFromFile(X.CFB.write(zip,{type:'array',fileType:'zip'}),'short-year.xlsx');
  for(const[r,[value,code]]of examples.entries()) {
    expect(back.getValue(back.activeSheetId,r,0)).toBe(value);
    expect(back.styleAt(back.activeSheetId,r,0).code).toBe(code);
    expect(back.getDisplay(back.activeSheetId,r,0)).toBe(formatWithCode(value,code));
    expect(back.getValue(back.activeSheetId,r,1)).toBe(formatWithCode(value,code));
  }
});
