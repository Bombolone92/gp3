import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { readXlsxConditionalFormats } from '../src/core/xlsx-condformat.js';
import * as X from '../src/vendor/xlsx.mjs';

const paint={bg:'#b6e6ad'},dec=new TextDecoder();
function book(sqref='A1:A2 C1:C2',type='duplicateValues'){
 const wb=new Workbook(),id=wb.activeSheetId;
 wb.setCells(id,[{r:0,c:0,cell:{v:'a'}},{r:1,c:0,cell:{v:'b'}},{r:0,c:2,cell:{v:'a'}},{r:1,c:2,cell:{v:'c'}}]);
 for(const rule of readXlsxConditionalFormats(`<conditionalFormatting sqref="${sqref}"><cfRule type="${type}" dxfId="0" priority="1" stopIfTrue="0"/></conditionalFormatting>`,{dxfs:[paint]}))wb.addRule(id,rule);
 return wb;
}
async function external(wb){
 const zip=X.CFB.read(new Uint8Array(await(await workbookToXlsx(wb)).arrayBuffer()),{type:'array'});
 const sheetXml=dec.decode(X.CFB.find(zip,'/xl/worksheets/sheet1.xml').content),part=X.CFB.find(zip,'/xl/workbook.xml');
 part.content=new TextEncoder().encode(dec.decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g,''));part.size=part.content.length;
 return {wb:await workbookFromFile(X.CFB.write(zip,{type:'array',fileType:'zip'}),'native-duplicates.xlsx'),sheetXml};
}
const read=(wb,offset=0)=>[0,1].flatMap(r=>[0,2].map(c=>!!wb.conditionalStyle(wb.activeSheetId,r+offset,c,wb.getValue(wb.activeSheetId,r+offset,c))?.bg));

it.each(['duplicateValues','uniqueValues'])('rejoins complete native %s sources without changing their priority or live counts',async type=>{
 let wb=book(undefined,type);const expected=type==='duplicateValues'?[true,true,false,false]:[false,false,true,true];
 for(let pass=0;pass<2;pass++){
  expect(read(wb)).toEqual(expected);
  const back=await external(wb);expect(back.sheetXml).toContain(`type="${type}"`);
  expect(back.sheetXml).toContain('sqref="A1:A2 C1:C2"');
  expect(back.sheetXml.match(/<cfRule\b/g)).toHaveLength(1);
  wb=back.wb;expect(wb.activeSheet.rules).toHaveLength(2);
 }
 wb.setInput(wb.activeSheetId,1,2,'b');expect(read(wb)).toEqual(type==='duplicateValues'?[true,true,true,true]:[false,false,false,false]);
 wb.undo();expect(read(wb)).toEqual(expected);
});
it('retains overlapping and repeated source areas in native sqref',async()=>{
 for(const sqref of ['A1:A2 A2:A3','A1:A2 A1:A2']){
  const wb=book(sqref),expected=read(wb),back=await external(wb);
  expect(back.sheetXml).toContain(`sqref="${sqref}"`);expect(read(back.wb)).toEqual(expected);
 }
});
it('keeps a copied counting scope live when its paint range differs from the source',async()=>{
 let wb=book(),id=wb.activeSheetId;
 wb.placeSheetAt(id,wb,id,10,0);
 expect(read(wb,10)).toEqual([true,true,false,false]);
 const back=await external(wb);expect(back.sheetXml).toContain('type="duplicateValues"');expect(back.sheetXml).toContain('type="expression"');
 wb=back.wb;id=wb.activeSheetId;expect(read(wb)).toEqual([true,true,false,false]);expect(read(wb,10)).toEqual([true,true,false,false]);
 wb.setInput(id,0,2,'different');expect(read(wb,10)).toEqual([false,false,false,false]);
 wb.undo();expect(read(wb,10)).toEqual([true,true,false,false]);
});
it('keeps source references through insertions, deletion and sheet renames',async()=>{
 const wb=book(),id=wb.activeSheetId;
 wb.insertRows(id,0,2);expect(wb.activeSheet.rules[0].duplicateRange).toBe('($A$3:$A$4,$C$3:$C$4)');
 expect(read(wb,2)).toEqual([true,true,false,false]);
 wb.undo();expect(read(wb)).toEqual([true,true,false,false]);
 const second=wb.addSheet('Other');
 wb.addRule(second.id,{type:'dup',range:{r1:0,c1:0,r2:0,c2:0},duplicateRange:"Sheet1!$A$1:$A$2",style:paint});
 wb.renameSheet(id,'Input');expect(wb.sheet(second.id).rules[0].duplicateRange).toContain('Input!');
});

it.each(['dup','unique'])('exports long %s scopes as bounded live named functions',async type=>{
 let wb=book(),id=wb.activeSheetId;
 wb.activeSheet.rules=[];
 // Repeated and overlapping areas deliberately retain multiplicity; distant
 // paint cells keep their counting scope fixed, including relative user input.
 wb.addRule(id,{type,range:{r1:10,c1:0,r2:11,c2:0},duplicateRange:`(${Array.from({length:40},()=> 'A1:A2').join(',')})`,style:paint});
 wb.setInput(id,10,0,'a');wb.setInput(id,11,0,'absent');
 wb.defineName('_PuterCF1','42');wb.defineName('_PuterCF2','17',wb.activeSheet.name);
 const expected=type==='dup'?[true,false]:[false,false];
 const colors=()=>[10,11].map(r=>!!wb.conditionalStyle(id,r,0,wb.getValue(id,r,0))?.bg);
 let count;
 for(let pass=0;pass<2;pass++){
  expect(colors()).toEqual(expected);
  const back=await external(wb);
  expect(back.sheetXml).toContain('_PuterCF');
  wb=back.wb;id=wb.activeSheetId;
  expect(colors()).toEqual(expected);
  const helpers=wb.names.filter(n=>n.hidden);
  expect(helpers.length).toBeGreaterThan(1);
  expect(helpers.every(n=>n.ref.startsWith('LAMBDA('))).toBe(true);
  if(count!=null)expect(helpers.length).toBe(count);
  count=helpers.length;
  expect(wb.namedEntry('_PuterCF1').ref).toBe('42');
 }
 wb.setInput(id,0,0,'different');expect(colors()).toEqual([false,false]);
 wb.undo();expect(colors()).toEqual(expected);
 const copied=new Workbook(),[sheet]=copied.importSheets(wb);
 expect([10,11].map(r=>!!copied.conditionalStyle(sheet.id,r,0,copied.getValue(sheet.id,r,0))?.bg)).toEqual(expected);
});
