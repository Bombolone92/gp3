// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { formatWithCode } from '../src/core/numfmt.js';
import { setLocale } from '../src/core/format.js';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { cellsToHtml, parseHtmlClipboard, cellsFromHtmlRows } from '../src/core/clipboard.js';
import * as X from '../src/vendor/xlsx.mjs';
import { calc } from './helpers/calc.js';
import native from './fixtures/reference-hijri-month-names.json';

afterEach(() => setLocale('en-US'));

it('matches native Hijri month widths and regional vocabulary without leaking legacy name state', () => {
  for(const [value,code,expected] of native.cases) {
    expect(formatWithCode(value,code),`${value}: ${code}`).toBe(expected?.error?'#####':expected);
    expect(calc(`TEXT(${value},"${code.replaceAll('"','""')}")`),`${value}: ${code}`).toEqual(expected);
  }
  // Assert every language's month fields even where a separate weekday
  // vocabulary difference is still recorded in knownDifferences.
  for(const [value,code,short,long] of native.monthWidths) {
    expect(formatWithCode(value,code).split('|').slice(0,2),`${value}: ${code}`).toEqual([short,long]);
  }
});

it('keeps modern widths immutable while B2 replaces the month resource at mmm', () => {
  for(const locale of ['en-US','fr-FR','de-DE']) {
    setLocale(locale);
    expect(formatWithCode(45929,'[$-60409]mmmm|mmm|mmmm|mmmmm')).toBe('Rabiʻ II|Rab. II|Rabiʻ II|R');
    expect(formatWithCode(45929,'B2[$-60409]mmmm|mmm|mmmm')).toBe('Rabiʻ II|ربيع\u00a0الثاني|ربيع\u00a0الثاني');
    expect(formatWithCode(45929,'[$-60c01]mmmm|mmm')).toBe('ربيع الآخرة|ربيع الآخرة');
    expect(formatWithCode(45929,'B2[$-0c01]mmmm|mmm')).toBe('ربيع الآخرة|ربيع\u00a0الثاني');
    expect(formatWithCode(45929,'[$-60404]mmm|mmmm')).toBe('Rab.\u202fII|賴比月II');
    expect(formatWithCode(45929,'[$-60439]mmm|mmmm')).toBe('रबी २|रबी अस्सानी');
    expect(formatWithCode(45929,'[$-60403]mmm|mmmm')).toBe('Rab.\u202fII|de rabiʻ II');
    expect(formatWithCode(45929,'[$-6041f]mmm|mmmm')).toBe('Rebiyülahir|Rebiyülahir');
  }
});

it('preserves date values and regional month formats through editing, HTML and metadata-free XLSX', async () => {
  const examples=[[45929,'[$-60409]mmm mmmm'],[45929,'B2[$-0c01]mmmm mmm'],[45929,'[$-60404]mmm mmmm'],[45929,'[$-60439]mmm mmmm'],[45929,'[$-60403]mmm mmmm'],[45929,'[$-6041f]mmm mmmm']];
  const wb=new Workbook(),id=wb.activeSheetId;
  for(const[r,[value,code]]of examples.entries()) {
    wb.setInput(id,r,0,String(value));wb.applyStyle(id,{r1:r,c1:0,r2:r,c2:0},{fmt:'custom',code});
    wb.setInput(id,r,1,`=TEXT(A${r+1},"${code}")`);
    const html=cellsToHtml([[formatWithCode(value,code)]],[[wb.getCell(id,r,0)]],null,[[value]]).replace(/ data-spreadsheet-[\w-]+="[^"]*"/g,'');
    const cell=cellsFromHtmlRows(parseHtmlClipboard(html).rows)[0].cell;
    expect(cell.v).toBe(value);expect(cell.s.code).toBe(code);
  }
  wb.setInput(id,0,0,'45958');expect(wb.getValue(id,0,1)).toBe('Jum. I Jumada I');
  wb.undo();expect(wb.getValue(id,0,1)).toBe('Rab. II Rabiʻ II');
  const blob=await workbookToXlsx(wb),bytes=await new Promise(resolve=>{const r=new FileReader();r.onload=()=>resolve(new Uint8Array(r.result));r.readAsArrayBuffer(blob);});
  const zip=X.CFB.read(bytes,{type:'array'}),part=X.CFB.find(zip,'/xl/workbook.xml');
  part.content=new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g,''));part.size=part.content.length;
  const back=await workbookFromFile(X.CFB.write(zip,{type:'array',fileType:'zip'}),'hijri-months.xlsx');
  for(const[r,[value,code]]of examples.entries()) {
    expect(back.getValue(back.activeSheetId,r,0)).toBe(value);
    expect(back.styleAt(back.activeSheetId,r,0).code).toBe(code);
    expect(back.getDisplay(back.activeSheetId,r,0)).toBe(formatWithCode(value,code));
    expect(back.getValue(back.activeSheetId,r,1)).toBe(formatWithCode(value,code));
  }
});
