import {expect,it} from 'vitest';
import {dataBar} from '../src/core/condformat.js';
import {Workbook} from '../src/core/workbook.js';
import {workbookFromFile,workbookToXlsx} from '../src/core/io.js';
import * as X from '../src/vendor/xlsx.mjs';
const base={type:'databar',barMode:'extended',barMinLength:0,barMaxLength:100,barColor:'#638ec6'};
// Excel controls: symmetric/asymmetric, numeric/reference,
// reversed bounds, custom lengths, candidates near and beyond the high stop.
it.each([[-1.5e308,5e307],[-1e308,1e308],[-1.7e308,1e307],[-Number.MAX_VALUE,Number.MAX_VALUE]])('automatic overflowing domain %s/%s collapses at the upper stop',(lo,hi)=>{
 for(const [min,max]of [[lo,hi],[hi,lo]])for(const [value,fraction]of [[lo,0],[-1,0],[0,0],[hi/2,0],[hi*(1-1e-12),0],[hi,.5],...(hi<Number.MAX_VALUE?[[hi*(1+1e-12),1]]:[])]){
  const paint=dataBar({...base,barAxisPosition:'automatic'},value,min,max);
  expect(paint.bar).toBe(fraction);expect(paint.barStart).toBe(0);expect(paint.barAxis).toBeUndefined();
  expect(paint.barColor).toBe(value<0?'#ff0000':'#638ec6');
 }
});
it('keeps the automatic axis margin, minimum lengths and mirrored direction during overflow',()=>{
 const rule={...base,barAxisPosition:'automatic',barMinLength:20,barMaxLength:60};
 for(const [value,length,start]of [[-1.7e308,.1,.2],[-1,.1,.2],[0,.1,.3],[2.5e307,.1,.3],[5e307,.3,.3],[1e308,.5,.3]]){
  const paint=dataBar(rule,value,-1.5e308,5e307);
  expect(paint.bar).toBeCloseTo(length,14);expect(paint.barStart).toBeCloseTo(start,14);expect(paint.barAxis).toBeCloseTo(.3,14);
  const right=dataBar({...rule,barDirection:'rightToLeft'},value,-1.5e308,5e307);
  expect(right.bar).toBeCloseTo(length,14);expect(right.barStart).toBeCloseTo(1-start-length,14);expect(right.barAxis).toBeCloseTo(.7,14);
  expect(dataBar(rule,value,-1.5e308,5e307,true)).toEqual(right);
 }
});
it.each([[2e307,1e308],[-1e308,-2e307],[-1e308,5e307],[-1.5e308,5e307]])('centered bars keep only minimum length when twice the scale overflows (%s/%s)',(lo,hi)=>{
 for(const [min,max]of [[lo,hi],[hi,lo]])for(const value of [lo,lo/2+hi/2,hi]){
  const rule={...base,barAxisPosition:'middle'};
  expect(dataBar(rule,value,min,max)).toMatchObject({bar:0,barAxis:.5,barStart:.5});
  const paint=dataBar({...rule,barMinLength:20,barMaxLength:60},value,min,max);
  expect(paint.bar).toBe(.1);expect(paint.barAxis).toBe(.5);expect(paint.barStart).toBe(value<0?.4:.5);
 }
});
it('distinguishes a finite automatic span from an overflowing doubled centered scale',()=>{
 const rule={...base,barAxisPosition:'automatic'};
 for(const [value,length,start]of [[-1e308,2/3,0],[-5e307,1/3,1/3],[0,0,2/3],[2.5e307,1/6,2/3],[5e307,1/3,2/3]]){
  const paint=dataBar(rule,value,-1e308,5e307);
  expect(paint.bar).toBeCloseTo(length,14);expect(paint.barStart).toBeCloseTo(start,14);expect(paint.barAxis).toBeCloseTo(2/3,14);
 }
 expect(dataBar({...rule,barAxisPosition:'middle'},4e307,-8e307,8e307)).toMatchObject({bar:.25,barStart:.5,barAxis:.5});
 expect(dataBar({...rule,barAxisPosition:'middle'},0,0,0)).toMatchObject({bar:0,barStart:.5,barAxis:.5});
 expect(dataBar({...rule,barAxisPosition:'middle'},-1,0,0)).toMatchObject({bar:.5,barStart:0,barAxis:.5});
});
const look=(w,r,c=2)=>w.conditionalStyle(w.activeSheetId,r,c,w.getValue(w.activeSheetId,r,c));
const nativeSave=async w=>{
 const zip=X.CFB.read(new Uint8Array(await(await workbookToXlsx(w)).arrayBuffer()),{type:'array'}),p=X.CFB.find(zip,'/xl/workbook.xml');
 p.content=new TextEncoder().encode(new TextDecoder().decode(p.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g,''));p.size=p.content.length;
 return workbookFromFile(X.CFB.write(zip,{type:'array',fileType:'zip'}),'signed-bars.xlsx');
};
it.each(['automatic','middle'])('%s overflow survives native saves, copies and live formula edits',async barAxisPosition=>{
 let w=new Workbook(),id=w.activeSheetId;
 w.setInput(id,0,0,'-1.5e308');w.setInput(id,1,0,'5e307');
 [-1.5e308,0,2.5e307,5e307,1e308].forEach((v,i)=>w.setInput(id,i+2,2,String(v)));
 w.addRule(id,{...base,range:{r1:2,c1:2,r2:6,c2:2},barAxisPosition,barMinFormula:'$A$1',barMaxFormula:'$A$2'});
 for(let pass=0;pass<2;pass++){
  w=await nativeSave(w);const expected=barAxisPosition==='automatic'?[0,0,0,.5,1]:[0,0,0,0,0];
  expected.forEach((n,i)=>expect(look(w,i+2).bar).toBe(n));
 }
 id=w.activeSheetId;const rows=[2,3,4,5,6];
 w.pasteCells(id,w.copyCells(id,rows,[2]),10,5,{r:2,c:2},null,{conditionalFormats:w.copyConditionalFormats(id,rows,[2])});
 expect(look(w,13,5).bar).toBe(barAxisPosition==='automatic'?.5:0);
 w.setInput(id,0,0,'-5e307');expect(look(w,4).bar).toBe(.25);expect(look(w,12,5).bar).toBe(.25);
 w.undo();expect(look(w,12,5).bar).toBe(0);
});
