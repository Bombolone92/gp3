import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { ICON_SETS } from '../src/core/condformat.js';
import { NATIVE_ICON_SETS } from '../src/core/native-icons.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import * as X from '../src/vendor/xlsx.mjs';
const families={arrows:'3Arrows',traffic:'3TrafficLights1',flags:'3Flags',stars:'3Stars',checks:'3Symbols2'};
const range={r1:2,c1:2,r2:6,c2:2};
function make(values,options={}){
 const wb=new Workbook(),id=wb.activeSheetId;
 values.forEach((v,i)=>wb.setInput(id,i+2,2,String(v)));
 wb.addRule(id,{type:'icons',range,set:'arrows',...options});return wb;
}
const look=(wb,r,c=2)=>wb.conditionalStyle(wb.activeSheetId,r,c,wb.getValue(wb.activeSheetId,r,c));
const zipOf=async wb=>X.CFB.read(new Uint8Array(await(await workbookToXlsx(wb)).arrayBuffer()),{type:'array'});
const xml=(zip,path='/xl/worksheets/sheet1.xml')=>new TextDecoder().decode(X.CFB.find(zip,path).content);
const edit=(zip,fn,path='/xl/worksheets/sheet1.xml')=>{const p=X.CFB.find(zip,path);p.content=new TextEncoder().encode(fn(xml(zip,path)));p.size=p.content.length;};
const reopen=zip=>workbookFromFile(X.CFB.write(zip,{type:'array',fileType:'zip'}),'icons.xlsx');
const removePrivate=zip=>edit(zip,s=>s.replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g,''),'/xl/workbook.xml');
function match(app,native,r,c=2,set='arrows'){
 const a=look(app,r,c),b=look(native,r,c);
 if(!a?.icon){expect(b?.icon).toBeUndefined();return;}
 const index=ICON_SETS[set].glyphs.findIndex((glyph,i)=>glyph===a.icon&&ICON_SETS[set].colors[i]===a.iconColor);
 expect(index).toBeGreaterThanOrEqual(0);
 expect(b).toMatchObject({iconImage:NATIVE_ICON_SETS[families[set]].images[2-index],iconOnly:a.iconOnly});
}
const cases=[
 [[0,25,50,75,100],{}], [[-100,-75,-50,-25,0],{lo:25,hi:75}], [[0,0,0,0,0],{}],
 [[10,10,10,10,10],{lo:100,hi:100}], [[0,25,50,75,100],{lo:75,hi:25}],
 [[0,25,50,75,100],{lo:-10,hi:120}], [[-1.5e308,-7.5e307,0,7.5e307,1.5e308],{}],
 [[1,1.0000000000000002,1.0000000000000004,1.0000000000000007,1.0000000000000009],{lo:25,hi:75}],
 [[0,2**-1022,2**-1021,2**-1020,2**-1019],{}],
 [[0,25,50,75,100],{lo:25.000000000000004,hi:75.00000000000001}],
 [[0,1,2,1e307,1e308],{lo:1e-307,hi:1e-306}],
];
it.each(cases)('exports live app icon categories for %j with %j',async(values,options)=>{
 for(const set of Object.keys(families)){
  const wb=make(values,{...options,set,iconOnly:true}),before=wb.toJSON(),zip=await zipOf(wb);
  expect(wb.toJSON()).toEqual(before);expect((await reopen(zip)).activeSheet.rules).toEqual(wb.activeSheet.rules);
  removePrivate(zip);let back=await reopen(zip);
  for(let pass=0;pass<2;pass++){
   for(let r=2;r<=6;r++)match(wb,back,r,2,set);
   const next=await zipOf(back);removePrivate(next);back=await reopen(next);
  }
  wb.setInput(wb.activeSheetId,6,2,'200');back.setInput(back.activeSheetId,6,2,'200');
  for(let r=2;r<=6;r++)match(wb,back,r,2,set);
 }
});
it('preserves predicates, hidden values, independent priorities and later fills',async()=>{
 const wb=make([0,25,50,75,100],{iconOnly:true,iconActiveFormula:'D3',stopIfTrue:true}),id=wb.activeSheetId;
 [1,0,1,0,1].forEach((v,i)=>wb.setInput(id,i+2,3,String(v)));
 wb.addRule(id,{type:'icons',range,set:'checks'});
 wb.addRule(id,{type:'gt',range,value:-1,style:{bg:'#abcdef',bold:true}});
 const zip=await zipOf(wb);removePrivate(zip);const back=await reopen(zip);
 for(let r=2;r<=6;r++){
  match(wb,back,r,2,r%2===0?'arrows':'checks');
  expect(look(back,r)).toMatchObject({bg:'#abcdef',bold:true});
 }
});
it('retains independent copied source domains, including empty sources and undo',async()=>{
 const wb=make([0,25,50,75,100]),id=wb.activeSheetId,rows=[3,4,5];
 wb.pasteCells(id,wb.copyCells(id,rows,[2]),10,7,{r:3,c:2},null,{conditionalFormats:wb.copyConditionalFormats(id,rows,[2])});
 const zip=await zipOf(wb);removePrivate(zip);const back=await reopen(zip);
 for(const value of ['200','text']){
  wb.setInput(id,6,2,value);back.setInput(back.activeSheetId,6,2,value);
  for(let r=10;r<=12;r++)match(wb,back,r,7);
 }
 const empty=make([1,2,3,4,5],{statisticsRange:'($K$1:$K$2,$M$1:$M$2)',iconOnly:true});
 const z=await zipOf(empty);expect(xml(z)).toContain('COUNT($K$1:$K$2,$M$1:$M$2)');removePrivate(z);const n=await reopen(z);
 expect(look(n,2)).toBeNull();
 for(const model of [empty,n])model.setInput(model.activeSheetId,0,10,'7');
 match(empty,n,2);n.undo();expect(look(n,2)).toBeNull();
});
it('ignores nonnumeric candidates without hiding their values',async()=>{
 const wb=make(['text',true,'=1/0','',40],{iconOnly:true}),zip=await zipOf(wb);removePrivate(zip);const back=await reopen(zip);
 for(let r=2;r<6;r++)expect(look(back,r)).toBeNull();match(wb,back,6);
});
it('keeps native edits and deletions instead of resurrecting the app rule',async()=>{
 const wb=make([0,25,50,75,100]),zip=await zipOf(wb);
 edit(zip,s=>s.replace('showValue="1"','showValue="0"'));
 const changed=await reopen(zip);expect(changed.activeSheet.rules).toHaveLength(3);
 expect(changed.activeSheet.rules[0].iconOnly).toBe(true);
 const removed=await zipOf(wb);edit(removed,s=>s.replace(/<x14:conditionalFormatting\b[^]*?<\/x14:conditionalFormatting>/,''));
 expect((await reopen(removed)).activeSheet.rules).toHaveLength(2);
});
