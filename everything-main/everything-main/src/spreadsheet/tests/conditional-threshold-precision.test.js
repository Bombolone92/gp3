import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { conditionalThresholdFormula } from '../src/core/conditional-scale.js';
import { conditionalFormatSignature, reconcileConditionalFormats } from '../src/core/xlsx-condformat-reconcile.js';
import * as X from '../src/vendor/xlsx.mjs';
const range={r1:2,c1:2,r2:9,c2:2};
const values=[0,33.33333333333332,33.33333333333333,33.333333333333336,66.66666666666664,66.66666666666666,66.66666666666667,100];
const look=(w,r,c=2)=>w.conditionalStyle(w.activeSheetId,r,c,w.getValue(w.activeSheetId,r,c));
const icons=(w,c=2,start=2)=>values.map((_,i)=>look(w,start+i,c)?.icon);
const expectedFor=type=>['↓','↓','↓',type==='percentile'?'↓':'→','→','→','↑','↑'];
const make=type=>{
 const w=new Workbook(),id=w.activeSheetId;values.forEach((v,i)=>w.setInput(id,i+2,2,String(v)));
 w.setInput(id,0,9,'0');w.setInput(id,1,9,'100');
 w.addRule(id,{type:'icons',range,statisticsRange:'$J$1:$J$2',iconSet:'3Arrows',iconThreshold0Type:'num',iconThreshold0:'0',
  iconThreshold1Type:type,iconThreshold1:'33.333333333333336',iconThreshold2Type:type,iconThreshold2:'66.66666666666667'});
 return w;
};
async function native(w){
 const zip=X.CFB.read(new Uint8Array(await(await workbookToXlsx(w)).arrayBuffer()),{type:'array'}),p=X.CFB.find(zip,'/xl/workbook.xml');
 p.content=new TextEncoder().encode(new TextDecoder().decode(p.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g,''));p.size=p.content.length;
 return workbookFromFile(X.CFB.write(zip,{type:'array',fileType:'zip'}),'precision.xlsx');
}
it.each(['percent','percentile'])('preserves %s cutoffs in live formulas, native saves and partial copies',async type=>{
 let w=make(type);const expected=expectedFor(type);
 for(let pass=0;pass<3;pass++){
  expect(icons(w)).toEqual(expected);
  w.setInput(w.activeSheetId,1,9,'200');expect(icons(w)).toEqual(['↓','↓','↓','↓','↓','↓',type==='percentile'?'↓':'→','→']);
  w.undo();expect(icons(w)).toEqual(expected);
  w=await native(w);
 }
 const id=w.activeSheetId,rows=[3,4,5,6,7,8];
 w.pasteCells(id,w.copyCells(id,rows,[2]),3,5,{r:3,c:2},null,{conditionalFormats:w.copyConditionalFormats(id,rows,[2])});
 w=await native(w);expect(rows.map(r=>look(w,r,5)?.icon)).toEqual(expected.slice(1,-1));
});
it.each(['percent','percentile'])('invalidates cached %s formula constants after threshold edits',type=>{
 const w=make(type),rule=w.activeSheet.rules[0];
 const evalBound=()=>w.evalRuleFormula(w.activeSheetId,conditionalThresholdFormula(rule,'iconThreshold1'),{r1:0,c1:0},0,0,undefined,true);
 expect(evalBound()).toBe(type==='percentile'?33.33333333333335:33.333333333333336);
 rule.iconThreshold1='33.33333333333334';expect(evalBound()).toBe(type==='percentile'?33.33333333333335:33.33333333333334);
 rule.statisticsRange='$J$1:$J$3';w.setInput(w.activeSheetId,2,9,'200');
 expect(evalBound()).toBe(type==='percentile'?66.6666666666667:66.66666666666669);
});
it.each([1.5e308,1.0000000000000002])('preserves an implicit scale midpoint between numeric bounds ending at %s',async high=>{
 let w=new Workbook(),id=w.activeSheetId;[0,high/2,high].forEach((v,i)=>w.setInput(id,i+2,2,String(v)));
 w.addRule(id,{type:'scale',range:{...range,r2:4},from:'#000000',mid:'#ff0000',to:'#ffffff',scaleMinType:'num',scaleMin:'0',scaleMaxType:'num',scaleMax:String(high)});
 for(let pass=0;pass<3;pass++){
  expect([2,3,4].map(r=>look(w,r)?.bg)).toEqual(['#000000','#ff0000','#ffffff']);w=await native(w);
 }
});
it.each(['num','percent','percentile'])('keeps version-one signatures compatible with historical %s formula literals',async type=>{
 const rule={type:'scale',range,statisticsRange:'$J$1:$J$2',scaleMinType:type,scaleMin:type==='num'?'1.5e308':'33.333333333333336',scaleMaxType:'max'};
 const old={type:'scale',range,scaleMin:type==='num'?'1.5e+308':type==='percent'
  ?'AGGREGATE(5,6,$J$1:$J$2)+(AGGREGATE(4,6,$J$1:$J$2)-AGGREGATE(5,6,$J$1:$J$2))*0.33333333333333337'
  :'AGGREGATE(16,6,$J$1:$J$2,0.33333333333333337)',scaleMax:'AGGREGATE(4,6,$J$1:$J$2)'};
 const signature=await conditionalFormatSignature(old,1),saved=[{...rule,id:'retained'}];
 expect(await conditionalFormatSignature(rule,1)).toBe(signature);
 expect(await reconcileConditionalFormats(saved,{version:1,entries:[{start:0,end:0,signatures:[signature]}]},[rule])).toEqual(saved);
 expect(await conditionalFormatSignature(rule)).not.toBe(await conditionalFormatSignature(old));
});
