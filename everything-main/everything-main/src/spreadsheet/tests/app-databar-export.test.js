import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import * as X from '../src/vendor/xlsx.mjs';
const range={r1:2,c1:2,r2:6,c2:2};
function make(values,options={}){
 const wb=new Workbook(),id=wb.activeSheetId;
 values.forEach((v,i)=>wb.setInput(id,i+2,2,String(v)));
 wb.addRule(id,{type:'databar',range,barColor:'#127abc',...options});return wb;
}
const look=(wb,r,c=2)=>wb.conditionalStyle(wb.activeSheetId,r,c,wb.getValue(wb.activeSheetId,r,c));
const zipOf=async wb=>X.CFB.read(new Uint8Array(await(await workbookToXlsx(wb)).arrayBuffer()),{type:'array'});
const xml=(zip,path='/xl/worksheets/sheet1.xml')=>new TextDecoder().decode(X.CFB.find(zip,path).content);
const edit=(zip,fn,path='/xl/worksheets/sheet1.xml')=>{const p=X.CFB.find(zip,path);p.content=new TextEncoder().encode(fn(xml(zip,path)));p.size=p.content.length;};
const reopen=zip=>workbookFromFile(X.CFB.write(zip,{type:'array',fileType:'zip'}),'bars.xlsx');
const removePrivate=zip=>edit(zip,s=>s.replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g,''),'/xl/workbook.xml');
const cases=[
 [[0,20,40,60,100],{}], [[-100,-80,-60,-40,-20],{}], [[-100,-50,0,50,100],{}],
 [[0,0,0,0,0],{}], [[-10,-10,-10,-10,-10],{}], [[10,10,10,10,10],{}],
 [[0,20,40,60,80],{barMin:40,barMax:20}], [[-40,-20,0,20,40],{barMin:-20,barMax:20}],
 [[-1e308,-5e307,0,5e307,1e308],{}], [[-1.5e308,-1e308,-5e307,0,1e308],{}],
 [[-1e-307,-5e-308,0,5e-308,1e-307],{}], [[0,Number.MIN_VALUE,Number.MIN_VALUE,Number.MIN_VALUE,0],{}],
 [[0,3.75e307,7.5e307,1.125e308,1.5e308],{barMin:0,barMax:1.5e308}],
 [[-1.5e308,-7.5e307,0,7.5e307,1.5e308],{barMin:-1.5e308,barMax:1.5e308}],
 [[1,1.0000000000000002,1.0000000000000004,1.0000000000000007,2],{barMin:1,barMax:1.0000000000000004}],
 [[1,1.0000000000000002,1.0000000000000004,1.0000000000000007,1.0000000000000009],{barMin:1.0000000000000002}],
 [[-1.0000000000000009,-1.0000000000000007,-1.0000000000000004,-1.0000000000000002,-1],{barMax:-1.0000000000000002}],
 [[0,2**-1022,2**-1021,2**-1020,2**-1019],{barMin:2**-1022,barMax:2**-1020}],
];
it.each(cases)('natively preserves live app-bar fractions for %j with %j',async(values,options)=>{
 const wb=make(values,{...options,barOnly:true}),before=wb.toJSON(),zip=await zipOf(wb);
 expect(wb.toJSON()).toEqual(before);expect((await reopen(zip)).activeSheet.rules).toEqual(wb.activeSheet.rules);
 removePrivate(zip);let back=await reopen(zip);
 for(let pass=0;pass<2;pass++){
  for(let i=0;i<values.length;i++){
   expect(look(back,i+2).bar).toBeCloseTo(look(wb,i+2).bar,13);
   expect(look(back,i+2)).toMatchObject({barColor:'#127abc',barOnly:true});
  }
  const again=await zipOf(back);removePrivate(again);back=await reopen(again);
 }
 wb.setInput(wb.activeSheetId,6,2,'25');back.setInput(back.activeSheetId,6,2,'25');
 for(let r=2;r<=6;r++)expect(look(back,r).bar).toBeCloseTo(look(wb,r).bar,13);
});

it('switches between full, ordinary and overflowing live domains after edits',async()=>{
 const wb=make([0,0,0,0,0]),zip=await zipOf(wb);removePrivate(zip);const back=await reopen(zip);
 for(const values of [[0,10,20,30,40],[-1e308,-5e307,0,5e307,1e308],[-4,-4,-4,-4,-4]]){
  for(const model of [wb,back])values.forEach((v,i)=>model.setInput(model.activeSheetId,i+2,2,String(v)));
  for(let r=2;r<=6;r++)expect(look(back,r).bar).toBeCloseTo(look(wb,r).bar,13);
 }
});
it('keeps predicates, hidden values, later fills and independent bar priorities',async()=>{
 const wb=make([0,20,40,60,100],{barActiveFormula:'D3',barOnly:true}),id=wb.activeSheetId;
 [1,0,1,0,1].forEach((v,i)=>wb.setInput(id,i+2,3,String(v)));
 wb.addRule(id,{type:'databar',range,barColor:'#ff9900',barMin:0,barMax:200});
 wb.addRule(id,{type:'gt',range,value:-1,style:{bg:'#abcdef',bold:true}});
 const zip=await zipOf(wb),priorities=[...xml(zip).matchAll(/<cfRule\b[^>]*priority="(\d+)"/g)].map(m=>Number(m[1]));
 expect(priorities).toEqual([1,2,3,4,5,6,7,8,9]);removePrivate(zip);const back=await reopen(zip);
 for(let r=2;r<=6;r++){
  expect(look(back,r).bar).toBeCloseTo(look(wb,r).bar);
  expect(look(back,r).barColor).toBe(look(wb,r).barColor);
  expect(!!look(back,r).barOnly).toBe(!!look(wb,r).barOnly);
  expect(look(back,r)).toMatchObject({bg:'#abcdef',bold:true});
 }
});
it('does not resurrect an app rule when one of its native projections is changed or deleted',async()=>{
 const wb=make([0,20,40,60,100]),zip=await zipOf(wb),original=wb.activeSheet.rules[0];
 expect((await reopen(zip)).activeSheet.rules).toEqual([original]);
 edit(zip,s=>s.replace('showValue="1"','showValue="0"'));
 // Edit the authoritative linked extension too; the legacy fallback is subordinate.
 edit(zip,s=>s.replace(/(<x14:dataBar\b[^>]*showValue=")1/, '$10'));
 const edited=await reopen(zip);expect(edited.activeSheet.rules).toHaveLength(4);
 expect(edited.activeSheet.rules.every(r=>r.id!==original.id)).toBe(true);
 expect(edited.activeSheet.rules[0].barOnly).toBe(true);
 const deleted=await zipOf(wb);edit(deleted,s=>s.replace(/<conditionalFormatting\b[^]*?<\/conditionalFormatting>/,''));
 expect((await reopen(deleted)).activeSheet.rules).toHaveLength(3);
});
it('exports independently copied app domains and retains full app editing through unchanged metadata',async()=>{
 const wb=make([0,20,40,60,100]),id=wb.activeSheetId,rows=[3,4,5];
 wb.pasteCells(id,wb.copyCells(id,rows,[2]),10,7,{r:3,c:2},null,{conditionalFormats:wb.copyConditionalFormats(id,rows,[2])});
 const zip=await zipOf(wb);expect((await reopen(zip)).activeSheet.rules).toEqual(wb.activeSheet.rules);
 removePrivate(zip);const back=await reopen(zip);
 for(let i=0;i<3;i++)expect(look(back,10+i,7).bar).toBeCloseTo(look(wb,10+i,7).bar);
 wb.setInput(id,5,2,'200');back.setInput(back.activeSheetId,5,2,'200');
 expect(look(back,11,7).bar).toBeCloseTo(look(wb,11,7).bar);
});
it('leaves nonnumeric candidates and inactive-only values visible',async()=>{
 const wb=make(['text',true,'=1/0',20,40],{barActiveFormula:'FALSE',barOnly:true}),zip=await zipOf(wb);
 removePrivate(zip);const back=await reopen(zip);
 for(let r=2;r<=6;r++)expect(look(back,r)).toBeNull();
});
it('requires numeric source statistics even when explicit bounds are constant',async()=>{
 const wb=make([1,2,3,4,5],{barMin:0,barMax:0,statisticsRange:'($K$1:$K$2,$M$1:$M$2)'});
 wb.setInput(wb.activeSheetId,0,10,'TRUE');wb.setInput(wb.activeSheetId,1,10,'text');wb.setInput(wb.activeSheetId,0,12,'=1/0');
 const zip=await zipOf(wb);
 expect(xml(zip)).toContain('COUNT($K$1:$K$2,$M$1:$M$2)');
 expect(look(wb,2)).toBeNull();removePrivate(zip);const back=await reopen(zip);
 expect(look(back,2)).toBeNull();back.setInput(back.activeSheetId,0,10,'7');
 expect(look(back,2).bar).toBe(1);back.undo();expect(look(back,2)).toBeNull();
});
