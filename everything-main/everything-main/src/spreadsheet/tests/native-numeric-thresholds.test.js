import {expect,it,vi} from 'vitest';
import {Workbook} from '../src/core/workbook.js';
import {workbookFromFile,workbookToXlsx} from '../src/core/io.js';
import {readXlsxConditionalFormats} from '../src/core/xlsx-condformat.js';
import * as X from '../src/vendor/xlsx.mjs';
const range={r1:2,c1:2,r2:4,c2:2};
const types=['scale','legacy','extended'];
const ruleFor=(type,num=true)=>type==='scale'
 ? {type,range,from:'#000000',to:'#ffffff',scaleMin:'0',scaleMax:'1.5e+308',...num?{scaleMinType:'num',scaleMaxType:'num'}:{}}
 : {type:'databar',barMode:type,range,barMinFormula:'0',barMaxFormula:'1.5e+308',barAxisPosition:'none',barMinLength:0,barMaxLength:100,...num?{barMinFormulaType:'num',barMaxFormulaType:'num'}:{}};
const make=()=>{const w=new Workbook();[0,7.5e307,1.5e308].forEach((n,i)=>w.setInput(w.activeSheetId,i+2,2,String(n)));return w;};
const look=(w,r,c=2)=>w.conditionalStyle(w.activeSheetId,r,c,w.getValue(w.activeSheetId,r,c));
const check=(w,type,c=2)=>{
 if(type==='scale')expect([2,3,4].map(r=>look(w,r,c)?.bg)).toEqual(['#000000','#7f7f7f','#ffffff']);
 else [0,.5,1].forEach((v,i)=>expect(look(w,i+2,c)?.bar).toBeCloseTo(v,14));
};
const nativeSave=async w=>{
 const zip=X.CFB.read(new Uint8Array(await(await workbookToXlsx(w)).arrayBuffer()),{type:'array'}),p=X.CFB.find(zip,'/xl/workbook.xml');
 p.content=new TextEncoder().encode(new TextDecoder().decode(p.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g,''));p.size=p.content.length;
 return workbookFromFile(X.CFB.write(zip,{type:'array',fileType:'zip'}),'numeric-thresholds.xlsx');
};
it.each(types)('%s evaluates native doubles without formula literal conversion',type=>{
 const w=make(),evaluate=vi.spyOn(w,'evalRuleFormula');w.addRule(w.activeSheetId,ruleFor(type));check(w,type);
 expect(evaluate).not.toHaveBeenCalled();
});
it.each(types)('%s preserves numeric thresholds through native saves, copies and edits',async type=>{
 let w=make();w.addRule(w.activeSheetId,ruleFor(type));
 for(let pass=0;pass<2;pass++){w=await nativeSave(w);check(w,type);}
 const id=w.activeSheetId,rows=[2,3,4];
 w.pasteCells(id,w.copyCells(id,rows,[2]),2,5,{r:2,c:2},null,{conditionalFormats:w.copyConditionalFormats(id,rows,[2])});check(w,type,5);
 w.setInput(id,3,5,'0');expect(look(w,3,5)[type==='scale'?'bg':'bar']).toBe(type==='scale'?'#000000':0);
 w.undo();check(w,type,5);
});
it.each(types)('%s preserves fixed bounds when statistics come from a different range',async type=>{
 for(const statisticsRange of ['$J$1:$J$2', "'Other source'!$B$2:$B$3"]){
  let w=make();w.addSheet('Other source');w.setActiveSheet(w.sheets[0].id);
  w.setInput(w.activeSheetId,0,9,'0');w.setInput(w.activeSheetId,1,9,'100');
  w.setInput(w.sheets[1].id,1,1,'0');w.setInput(w.sheets[1].id,2,1,'100');
  w.addRule(w.activeSheetId,{...ruleFor(type),statisticsRange});
  for(let pass=0;pass<3;pass++){
   check(w,type);
   const rule=w.activeSheet.rules[0],keys=type==='scale'?['scaleMin','scaleMax']:['barMinFormula','barMaxFormula'];
   for(const key of keys)expect(rule[`${key}Type`]).toBe('num');
   w=await nativeSave(w);
  }
  const id=w.activeSheetId,rows=[2,3];
  w.pasteCells(id,w.copyCells(id,rows,[2]),2,5,{r:2,c:2},null,{conditionalFormats:w.copyConditionalFormats(id,rows,[2])});
  expect(look(w,3,5)).toEqual(look(w,3));
  w=await nativeSave(w);expect(look(w,3,5)).toEqual(look(w,3));
 }
});
it.each(types)('%s keeps numeric and formula thresholds separate in the cache',type=>{
 for(const numericFirst of [false,true]){
  const w=make(),id=w.activeSheetId;
  w.addRule(id,ruleFor(type,numericFirst));w.addRule(id,ruleFor(type,!numericFirst));
  check(w,type);
 }
 const w=make();w.addRule(w.activeSheetId,ruleFor(type,false));expect(look(w,3)).toBeNull();
});
it('retains a native numeric stop beyond fifteen decimal digits',()=>{
 const w=new Workbook(),id=w.activeSheetId;
 const source='<conditionalFormatting sqref="C3:C3"><cfRule type="dataBar" priority="1"><dataBar minLength="0" maxLength="100"><cfvo type="num" val="1"/><cfvo type="num" val="1.0000000000000002"/><color rgb="FF123456"/></dataBar></cfRule></conditionalFormatting>';
 w.setInput(id,2,2,'1');for(const rule of readXlsxConditionalFormats(source,{}))w.addRule(id,rule);
 expect(look(w,2).bar).toBe(0);
 w.setInput(id,2,2,'1.0000000000000002');expect(look(w,2).bar).toBe(1);
});
it('resolves all three numeric scale stops, including a large middle stop',async()=>{
 let w=new Workbook(),id=w.activeSheetId;
 [0,7.5e307,1.5e308,1.6e308,1.7e308].forEach((v,i)=>w.setInput(id,i+2,2,String(v)));
 w.setInput(id,0,9,'0');w.setInput(id,1,9,'100');
 w.addRule(id,{type:'scale',range:{...range,r2:6},statisticsRange:'$J$1:$J$2',from:'#000000',mid:'#ff0000',to:'#ffffff',scaleMinType:'num',scaleMin:'0',scaleMidType:'num',scaleMid:'1.5e308',scaleMaxType:'num',scaleMax:'1.7e308'});
 for(let pass=0;pass<2;pass++){
  expect([2,3,4,5,6].map(r=>look(w,r)?.bg)).toEqual(['#000000','#7f0000','#ff0000','#ff7f7f','#ffffff']);
  w=await nativeSave(w);
 }
});
it.each(types)('%s retains precise fixed bounds alongside a live foreign maximum',async type=>{
 let w=new Workbook(),id=w.activeSheetId;
 [1,1.0000000000000002,1.0000000000000004].forEach((v,i)=>w.setInput(id,i+2,2,String(v)));
 w.setInput(id,0,9,'1.0000000000000004');
 const keys=type==='scale'?['scaleMin','scaleMax']:['barMinFormula','barMaxFormula'];
 w.addRule(id,{...ruleFor(type),statisticsRange:'$J$1:$J$2',[keys[0]]:'1.0000000000000002',[`${keys[1]}Type`]:'max'});
 for(let pass=0;pass<3;pass++){
  if(type==='scale')expect([2,3,4].map(r=>look(w,r)?.bg)).toEqual(['#000000','#000000','#ffffff']);
  else expect([2,3,4].map(r=>look(w,r)?.bar)).toEqual([0,0,1]);
  const rule=w.activeSheet.rules[0];expect(rule[`${keys[0]}Type`]).toBe('num');
  w.setInput(w.activeSheetId,0,9,'1.0000000000000007');
  expect(look(w,4)[type==='scale'?'bg':'bar']).toBe(type==='scale'?'#7f7f7f':.5);
  w.undo();
  w=await nativeSave(w);
 }
});
