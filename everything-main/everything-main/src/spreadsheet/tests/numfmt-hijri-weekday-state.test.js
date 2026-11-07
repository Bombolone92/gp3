// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { formatWithCode } from '../src/core/numfmt.js';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { cellsToHtml, parseHtmlClipboard, cellsFromHtmlRows } from '../src/core/clipboard.js';
import * as X from '../src/vendor/xlsx.mjs';
import { calc } from './helpers/calc.js';
import native from './fixtures/reference-hijri-weekday-state.json';

it('matches native legacy Hijri weekday state across all months and field orders', () => {
  for (const [value, code, expected] of native.cases) {
    expect(formatWithCode(value, code), `${value}: ${code}`).toBe(expected?.error ? '#####' : expected);
    expect(calc(`TEXT(${value},"${code.replaceAll('"', '""')}")`), `${value}: ${code}`).toEqual(expected);
  }
});

it('keeps real weekdays until the legacy month-name path is entered and isolates each rendering', () => {
  for (let repeat = 0; repeat < 3; repeat++) {
    expect(formatWithCode(45583, 'B2[$-409]ddd mmm ddd')).toBe('Fri ربيع\u00a0الثاني الأربعاء');
    expect(formatWithCode(45583, 'B2[$-409]ddd mmmm ddd')).toBe('Fri Rabiʻ II Fri');
    expect(formatWithCode(45583, '[$-60401]ddd mmm ddd')).toBe('الجمعة ربيع\u00a0الثاني الجمعة');
    expect(formatWithCode(45583, 'B2ddd mmmmm ddd')).toBe('الجمعة الجمعة الجمعة');
    expect(formatWithCode(45583, 'B2[$-409]ddd')).toBe('Fri');
  }
});

it('retains B2 field order through editing, HTML and metadata-free XLSX', async () => {
  const codes = ['B2ddd mmm ddd', 'B2[$-409]ddd mmm ddd', 'B2[$-0401]mmmm ddd', '[$-60401]mmm ddd', 'B2mmmmm ddd', 'B2[$-2000401]d mmm ddd', 'B2[$-10409]ddd mmm ddd', 'B2[$-70409]ddd mmm ddd'];
  const wb = new Workbook(), id = wb.activeSheetId;
  for (const [r, code] of codes.entries()) {
    wb.setInput(id, r, 0, '45583'); wb.applyStyle(id, {r1:r,c1:0,r2:r,c2:0}, {fmt:'custom',code});
    wb.setInput(id, r, 1, `=TEXT(A${r+1},"${code}")`);
    const expected = formatWithCode(45583, code);
    expect(wb.getDisplay(id,r,0)).toBe(expected);
    const html = cellsToHtml([[expected]], [[wb.getCell(id,r,0)]], null, [[45583]]).replace(/ data-spreadsheet-[\w-]+="[^"]*"/g,'');
    const cell = cellsFromHtmlRows(parseHtmlClipboard(html).rows)[0].cell;
    expect(cell.v).toBe(45583); expect(cell.s.code).toBe(code);
  }
  wb.setInput(id,1,0,'45524'); expect(wb.getValue(id,1,1)).toBe('Tue صفر الإثنين');
  wb.undo(); expect(wb.getValue(id,1,1)).toBe('Fri ربيع\u00a0الثاني الأربعاء');
  const blob = await workbookToXlsx(wb), bytes = await new Promise(resolve => { const r = new FileReader(); r.onload = () => resolve(new Uint8Array(r.result)); r.readAsArrayBuffer(blob); });
  const zip = X.CFB.read(bytes,{type:'array'}), part = X.CFB.find(zip,'/xl/workbook.xml');
  part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g,'')); part.size = part.content.length;
  const back = await workbookFromFile(X.CFB.write(zip,{type:'array',fileType:'zip'}),'legacy-hijri.xlsx');
  for(const [r,code] of codes.entries()) {
    expect(back.getValue(back.activeSheetId,r,0)).toBe(45583);
    expect(back.styleAt(back.activeSheetId,r,0).code).toBe(code);
    expect(back.getDisplay(back.activeSheetId,r,0)).toBe(formatWithCode(45583,code));
    expect(back.getValue(back.activeSheetId,r,1)).toBe(formatWithCode(45583,code));
  }
});
