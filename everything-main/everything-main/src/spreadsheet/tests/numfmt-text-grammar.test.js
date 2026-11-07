// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { formatWithCode, formatCodeError, codeColor, codeDateKind } from '../src/core/numfmt.js';
import { formatValue, editText, defaultAlign } from '../src/core/format.js';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { cellsToHtml, parseHtmlClipboard, cellsFromHtmlRows } from '../src/core/clipboard.js';
import * as X from '../src/vendor/xlsx.mjs';
import { calc } from './helpers/calc.js';
import native from './fixtures/reference-text-sections.json';

it('matches native TEXT results for text-section grammar and Boolean evaluation', () => {
  for (const [value, code, expected] of native.cases) {
    expect(formatWithCode(value, code, {textFunction:true}), `${value}: ${code}`).toBe(expected?.error ? '#####' : expected);
    const literal = typeof value === 'string' ? `"${value.replaceAll('"','""')}"` : String(value);
    expect(calc(`TEXT(${literal},"${code.replaceAll('"','""')}")`), `${value}: ${code}`).toEqual(expected);
  }
});

it.each(['@;0','@;@','@;0;0','0;@;0;0','@0','0@','yyyy@','@yyyy','@%','@.','@/','@1','@General','General@','0;[>0]@','0;0;0;yyyy','0;0;0;[h]','0;0;0;0.0','0;0;0;%','GeneralGeneral','General"x"General','General0','0General'])('rejects invalid text or General syntax throughout %s', code => {
  expect(formatCodeError(code)).toBeTruthy();
  for (const value of [1,-1,0,'label',true,false]) expect(formatWithCode(value,code)).toBe('#####');
  expect(codeColor('label',code)).toBe(null);
  expect(codeDateKind(1,code)).toBe(null);
});

it.each(['@"a"@','"General"@','@\\/','@\\1','0;0;0;General','0;0;0;AM/PM','B2@','0;[Red]@','0;0;0;[Red]'])('accepts legal text syntax %s', code => {
  expect(formatCodeError(code)).toBe(null);
});

it('keeps Boolean types, editing and alignment while using the text section and its color', () => {
  const code = '[Blue]0;[Green]"state: "@';
  for (const value of [true,false]) {
    expect(formatValue(value,{fmt:'custom',code})).toBe(`state: ${value ? 'TRUE' : 'FALSE'}`);
    expect(codeColor(value,code)).toBe('#00ff00');
    expect(editText({v:value,s:{fmt:'custom',code}})).toBe(value ? 'TRUE' : 'FALSE');
    expect(defaultAlign(value)).toBe('center');
    expect(codeColor(value,'[Red]0')).toBe(null);
    expect(formatValue(value,{fmt:'custom',code:';;;'})).toBe('');
    expect(codeDateKind(value,'0;0;0;AM/PM')).toBe(null);
  }
  expect(formatValue(true,{fmt:'percent'})).toBe('TRUE');
  expect(formatValue(false,{fmt:'date'})).toBe('FALSE');
});

it('distinguishes empty sections, empty literals and directive-only text sections', () => {
  for (const value of ['label',true,false]) {
    expect(formatWithCode(value,'0;0;0;')).toBe('');
    expect(formatWithCode(value,'0;0;0;[Red]""')).toBe('');
    expect(formatWithCode(value,'0;0;0;[Red]')).toBe(typeof value === 'boolean' ? String(value).toUpperCase() : value);
    expect(formatWithCode(value,'0;0;0;[$-409]')).toBe('');
  }
});

it('renders contiguous meridiem runs as one long field and separated fields independently', () => {
  for(const code of ['AM/PMAM/PM','A/PA/P','a/pA/P','AM/PMA/P','A/PAM/PM']) {
    expect(formatWithCode(.5,code)).toBe('PM');
    expect(formatWithCode('label',`0;0;0;${code}`)).toBe('AM');
  }
  expect(formatWithCode(true,'0;0;0;a/p A/P AM/PM')).toBe('a A AM');
  expect(formatWithCode(false,'AM/PM@')).toBe('AMFALSE');
});

it('reads explicit Office Boolean attributes independently of their formatted labels', () => {
  const html = '<table><tr><td x:bool="TRUE">AM</td><td x:bool="FALSE">AM</td><td x:bool="invalid">label</td></tr></table>';
  expect(cellsFromHtmlRows(parseHtmlClipboard(html).rows).map(({cell}) => cell.v)).toEqual([true,false,'label']);
});

it('preserves Boolean values and text-section formats through edits, clipboard and metadata-free XLSX', async () => {
  const cases = [[true,'[Red]"state: "@','state: TRUE'],[false,'0;0;0;"bool"@','boolFALSE'],[true,';;;',''],[false,'0;0;0;AM/PM','AM'],[true,'[$-F800];0;0;[$-F400]@',''],['label','[$-F800];0;0;[$-F400]@','label']];
  const wb=new Workbook(),id=wb.activeSheetId;
  for(const[r,[value,code,display]]of cases.entries()){
    wb.setInput(id,r,0,value,{literal:true});wb.applyStyle(id,{r1:r,r2:r,c1:0,c2:0},{fmt:'custom',code});
    wb.setInput(id,r,1,`=ISLOGICAL(A${r+1})`);
    expect(wb.getDisplay(id,r,0)).toBe(display);
    const html=cellsToHtml([[display]],[[wb.getCell(id,r,0)]],null,[[value]]).replace(/ data-spreadsheet-[\w-]+="[^"]*"/g,'');
    const cell=cellsFromHtmlRows(parseHtmlClipboard(html).rows)[0].cell;
    expect(cell.v).toBe(value);expect(cell.s.code).toBe(code);
  }
  wb.setInput(id,0,0,'FALSE');expect(wb.getDisplay(id,0,0)).toBe('state: FALSE');wb.undo();expect(wb.getValue(id,0,0)).toBe(true);
  const blob=await workbookToXlsx(wb),bytes=await new Promise(resolve=>{const r=new FileReader();r.onload=()=>resolve(new Uint8Array(r.result));r.readAsArrayBuffer(blob);});
  const zip=X.CFB.read(bytes,{type:'array'}),part=X.CFB.find(zip,'/xl/workbook.xml');part.content=new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g,''));part.size=part.content.length;
  const restored=await workbookFromFile(X.CFB.write(zip,{type:'array',fileType:'zip'}),'text-sections.xlsx');
  for(const[r,[value,code,display]]of cases.entries()){
    expect(restored.getValue(restored.activeSheetId,r,0)).toBe(value);
    expect(restored.styleAt(restored.activeSheetId,r,0).code).toBe(code);
    expect(restored.getDisplay(restored.activeSheetId,r,0)).toBe(display);
    expect(restored.getValue(restored.activeSheetId,r,1)).toBe(typeof value==='boolean');
  }
});
