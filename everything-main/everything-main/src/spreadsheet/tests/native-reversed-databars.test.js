import {expect,it} from 'vitest';
import {dataBar} from '../src/core/condformat.js';
import {Workbook} from '../src/core/workbook.js';
import {workbookFromFile,workbookToXlsx} from '../src/core/io.js';
import * as X from '../src/vendor/xlsx.mjs';
const base={type:'databar',barMode:'extended',barMinLength:0,barMaxLength:100,barColor:'#638ec6'};
// Axis-free extended bars interpolate in endpoint order, while signed
// automatic/centered axes sort their bounds. Positive/mixed/negative controls.
it.each([[0,100],[-60,20],[-100,-20]])('keeps axis-free descending bounds %s/%s', (lo,hi)=>{
 for(const [minLength,maxLength]of [[0,100],[20,60],[100,100]]){
  const rule={...base,barAxisPosition:'none',barMinLength:minLength,barMaxLength:maxLength};
  for(const [value,fraction]of [[lo-10,1],[lo,1],[(lo+hi)/2,.5],[hi,0],[hi+10,0]]){
   const paint=dataBar(rule,value,hi,lo),length=(minLength+(maxLength-minLength)*fraction)/100;
   expect(paint.bar).toBeCloseTo(length,14);expect(paint.barStart).toBe(0);expect(paint.barAxis).toBeUndefined();
   const right=dataBar({...rule,barDirection:'rightToLeft'},value,hi,lo);
   expect(right.bar).toBeCloseTo(length,14);expect(right.barStart).toBeCloseTo(1-length,14);
   expect(dataBar(rule,value,hi,lo,true)).toEqual(right);
   expect(paint.barColor).toBe(value<0?'#ff0000':'#638ec6');
  }
 }
});
it.each(['automatic','middle'])('%s continues to normalize descending bounds',barAxisPosition=>{
 for(const [lo,hi]of [[0,100],[-60,20],[-100,-20]])for(const v of [lo-10,lo,(lo+hi)/2,hi,hi+10]){
  const rule={...base,barAxisPosition,barMinLength:20,barMaxLength:60};
  expect(dataBar(rule,v,hi,lo)).toEqual(dataBar(rule,v,lo,hi));
 }
});
const look=(w,r,c=2)=>w.conditionalStyle(w.activeSheetId,r,c,w.getValue(w.activeSheetId,r,c));
const nativeSave=async w=>{
 const zip=X.CFB.read(new Uint8Array(await(await workbookToXlsx(w)).arrayBuffer()),{type:'array'}),p=X.CFB.find(zip,'/xl/workbook.xml');
 p.content=new TextEncoder().encode(new TextDecoder().decode(p.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g,''));p.size=p.content.length;
 return workbookFromFile(X.CFB.write(zip,{type:'array',fileType:'zip'}),'descending-bars.xlsx');
};
it.each(['num','formula'])('preserves descending %s stops through native saves, copies and live edits',async type=>{
 let w=new Workbook(),id=w.activeSheetId;
 [-70,-60,-20,20,30].forEach((v,i)=>w.setInput(id,i+2,2,String(v)));
 w.setInput(id,0,0,'20');w.setInput(id,1,0,'-60');
 w.addRule(id,{...base,range:{r1:2,c1:2,r2:6,c2:2},barAxisPosition:'none',barMinFormula:type==='num'?'20':'$A$1',barMaxFormula:type==='num'?'-60':'$A$2',...type==='num'?{barMinFormulaType:'num',barMaxFormulaType:'num'}:{}});
 for(let pass=0;pass<2;pass++){
  w=await nativeSave(w);[1,1,.5,0,0].forEach((n,i)=>expect(look(w,i+2).bar).toBeCloseTo(n));
 }
 id=w.activeSheetId;const rows=[2,3,4,5,6];
 w.pasteCells(id,w.copyCells(id,rows,[2]),10,5,{r:2,c:2},null,{conditionalFormats:w.copyConditionalFormats(id,rows,[2])});
 expect(look(w,12,5).bar).toBe(.5);
 if(type==='formula'){
  w.setInput(id,0,0,'60');expect(look(w,4).bar).toBeCloseTo(2/3);expect(look(w,12,5).bar).toBeCloseTo(2/3);
  w.undo();expect(look(w,12,5).bar).toBe(.5);
 }
});
