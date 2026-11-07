// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { formatWithCode } from '../src/core/numfmt.js';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { cellsToHtml, parseHtmlClipboard, cellsFromHtmlRows } from '../src/core/clipboard.js';
import * as X from '../src/vendor/xlsx.mjs';
import { calc } from './helpers/calc.js';
import native from './fixtures/reference-japanese-calendar.json';

it('matches native explicit Japanese calendar selection, era boundaries and field widths', () => {
  for (const [value, code, expected] of native.cases) {
    expect(formatWithCode(value, code), `${value}: ${code}`).toBe(expected?.error ? '#####' : expected);
    expect(calc(`TEXT(${value},"${code.replaceAll('"', '""')}")`), `${value}: ${code}`).toEqual(expected);
  }
});

it('keeps the language separate from an explicit calendar', () => {
  expect(formatWithCode(45000,'[$-30409]yyyy ggg e bbbb')).toBe('05 令和 5 2023');
  expect(formatWithCode(45000,'[$-10411]yyyy ggg e bbbb')).toBe('2023  2023 2023');
  expect(formatWithCode(45000,'[$-411]yyyy ggg e bbbb')).toBe('2023 令和 5 2023');
  expect(formatWithCode(43586,'[$-30411]y yy yyy yyyy')).toBe('01 01 01 01');
});

it('preserves explicit calendar semantics through edits, HTML and metadata-free XLSX', async () => {
  const cases = [[45000,'[$-30409]yyyy-mm-dd ggg e'],[43586,'[DBNum1][$-30411]yyyy-mm-dd'],[45000,'[$-10411]ggg e yyyy'],[45000,'[<0][$-30409]yyyy;yyyy']];
  const wb = new Workbook(), id = wb.activeSheetId;
  for (const [r,[value,code]] of cases.entries()) {
    wb.setInput(id,r,0,String(value));
    wb.applyStyle(id,{r1:r,r2:r,c1:0,c2:0},{fmt:'custom',code});
    wb.setInput(id,r,1,`=TEXT(A${r+1},"${code}")`);
    const expected=formatWithCode(value,code);
    expect(wb.getDisplay(id,r,0)).toBe(expected);
    const html=cellsToHtml([[expected]],[[wb.getCell(id,r,0)]],null,[[value]]).replace(/ data-spreadsheet-[\w-]+="[^"]*"/g,'');
    const cell=cellsFromHtmlRows(parseHtmlClipboard(html).rows)[0].cell;
    expect(cell.v).toBe(value); expect(cell.s.code).toBe(code);
  }
  wb.setInput(id,0,0,'43585'); expect(wb.getValue(id,0,1)).toBe('31-04-30 平成 31');
  wb.undo(); expect(wb.getValue(id,0,1)).toBe('05-03-15 令和 5');
  const blob=await workbookToXlsx(wb),bytes=await new Promise(resolve=>{const r=new FileReader();r.onload=()=>resolve(new Uint8Array(r.result));r.readAsArrayBuffer(blob);});
  const zip=X.CFB.read(bytes,{type:'array'}),part=X.CFB.find(zip,'/xl/workbook.xml');
  part.content=new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g,''));part.size=part.content.length;
  const restored=await workbookFromFile(X.CFB.write(zip,{type:'array',fileType:'zip'}),'eras.xlsx');
  for(const [r,[value,code]]of cases.entries()){
    expect(restored.getValue(restored.activeSheetId,r,0)).toBe(value);
    expect(restored.styleAt(restored.activeSheetId,r,0).code).toBe(code);
    expect(restored.getDisplay(restored.activeSheetId,r,0)).toBe(formatWithCode(value,code));
    expect(restored.getValue(restored.activeSheetId,r,1)).toBe(formatWithCode(value,code));
  }
});
