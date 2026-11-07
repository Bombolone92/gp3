import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import * as X from '../src/vendor/xlsx.mjs';
const range={r1:2,c1:2,r2:6,c2:2},types=['scale','legacy','extended','icons'];
const look=(w,r=4,c=2)=>w.conditionalStyle(w.activeSheetId,r,c,w.getValue(w.activeSheetId,r,c));
function make(type,formula=false,statisticsRange='$N$1:$N$2') {
 const w=new Workbook(),id=w.activeSheetId,bound=n=>formula?`$P$${n===0?1:n===50?2:3}`:String(n);
 [0,25,50,75,100].forEach((v,r)=>w.setInput(id,r+2,2,String(v)));
 [0,50,100].forEach((v,r)=>w.setInput(id,r,15,String(v)));
 const rule={range,statisticsRange,...type==='scale'?{type,from:'#000000',to:'#ffffff',scaleMin:bound(0),scaleMax:bound(100)}
  :type==='icons'?{type,iconSet:'3Arrows',iconThreshold0:bound(0),iconThreshold1:bound(50),iconThreshold2:bound(100)}
  :{type:'databar',barMode:type,barMinFormula:bound(0),barMaxFormula:bound(100),barMinLength:0,barMaxLength:100,barAxisPosition:'none'}};
 const keys=type==='scale'?['scaleMin','scaleMax']:type==='icons'?['iconThreshold0','iconThreshold1','iconThreshold2']:['barMinFormula','barMaxFormula'];
 if(!formula)for(const key of keys)rule[`${key}Type`]='num';
 w.addRule(id,rule);return w;
}
const check=(w,type,c=2)=>{
 if(type==='scale')expect([2,3,4,5,6].map(r=>look(w,r,c)?.bg)).toEqual(['#000000','#3f3f3f','#7f7f7f','#bfbfbf','#ffffff']);
 else if(type==='icons')expect([2,3,4,5,6].map(r=>look(w,r,c)?.icon)).toEqual(['↓','↓','→','→','↑']);
 else [0,.25,.5,.75,1].forEach((v,i)=>expect(look(w,i+2,c)?.bar).toBe(v));
};
async function save(w,privateData=false){
 const zip=X.CFB.read(new Uint8Array(await(await workbookToXlsx(w)).arrayBuffer()),{type:'array'});
 if(!privateData){const p=X.CFB.find(zip,'/xl/workbook.xml');p.content=new TextEncoder().encode(new TextDecoder().decode(p.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g,''));p.size=p.content.length;}
 return workbookFromFile(X.CFB.write(zip,{type:'array',fileType:'zip'}),'empty-source.xlsx');
}
it.each(types)('%s resolves independent bounds without any numeric statistics',async type=>{
 for(const formula of [false,true]){
  let w=make(type,formula);
  for(const value of ['', 'text', '=NA()', '=TRUE()']){w.setInput(w.activeSheetId,0,13,value);check(w,type);}
  w=await save(w,true);check(w,type);
  const id=w.activeSheetId,rows=[2,3,4,5,6];
  w.pasteCells(id,w.copyCells(id,rows,[2]),2,5,{r:2,c:2},null,{conditionalFormats:w.copyConditionalFormats(id,rows,[2])});check(w,type,5);
  w=await save(w);check(w,type);check(w,type,5);
 }
});
it.each(types)('%s keeps formula bounds live and suppresses invalid bounds without consuming priority',type=>{
 const w=make(type,true),id=w.activeSheetId;
 w.addRule(id,{type:'gt',range,value:-1,style:{bg:'#abcdef'},stopIfTrue:false});
 w.setInput(id,2,15,'200');
 expect(look(w)[type==='scale'?'bg':type==='icons'?'icon':'bar']).toBe(type==='scale'?'#3f3f3f':type==='icons'?'→':.25);
 w.undo();check(w,type);
 w.setInput(id,2,15,'=NA()');expect(look(w)).toEqual({bg:'#abcdef'});
 w.undo();check(w,type);
});
it.each(types)('%s ignores a missing statistical sheet when all bounds are independent',type=>check(make(type,false,"'Missing source'!$A$1:$A$2"),type));
it('evaluates dependent thresholds on empty sources using their aggregate semantics',async()=>{
 const w=make('icons'),id=w.activeSheetId,rule=w.activeSheet.rules[0];
 w.updateRule(id,rule.id,{iconThreshold1Type:'percent',iconThreshold1:'50'});
 expect([2,3,4,5,6].map(r=>look(w,r)?.icon)).toEqual(['→','→','→','→','↑']);
 const back=await save(w);expect([2,3,4,5,6].map(r=>look(back,r)?.icon)).toEqual(['→','→','→','→','↑']);
 w.updateRule(id,rule.id,{iconThreshold1Type:'percentile',iconThreshold1:'50'});expect(look(w)).toBeNull();
 w.setInput(id,0,13,'75');expect(look(w)?.icon).toBe('↓');w.undo();expect(look(w)).toBeNull();
});
it.each(['scale','legacy','extended'])('%s evaluates a mixed fixed/statistical bound on an empty source',async type=>{
 let w=make(type),id=w.activeSheetId,rule=w.activeSheet.rules[0],key=type==='scale'?'scaleMin':'barMinFormula';
 w.updateRule(id,rule.id,{[`${key}Type`]:'min'});check(w,type);
 w=await save(w);check(w,type);
});
