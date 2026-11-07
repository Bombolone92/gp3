import { expect, it } from 'vitest';
import { dataBar } from '../src/core/condformat.js';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import * as X from '../src/vendor/xlsx.mjs';

const base={type:'databar',barAxisPosition:'none',barMinLength:10,barMaxLength:60,barColor:'#638ec6'};
// Excel 16.113 for Mac, numeric/formula controls with symmetric/asymmetric
// bounds, descending legacy limits, custom lengths and out-of-range values.
// Overflowing subtraction uses a midpoint only INSIDE the closed interval.
it.each(['legacy','extended'])('%s uses the midpoint for overflowing native intervals',barMode=>{
 for(const [lo,hi] of [[-1e308,1e308],[-1.5e308,5e307],[-Number.MAX_VALUE,Number.MAX_VALUE]]){
  for(const [min,max] of [[lo,hi],[hi,lo]]){
   for(const value of [lo,lo/2,0,hi/2,hi]){
    expect(dataBar({...base,barMode},value,min,max).bar).toBeCloseTo(.35,14);
   }
  }
 }
});
it.each(['legacy','extended'])('%s still clips values strictly outside overflowing intervals',barMode=>{
 const lo=-1.5e308,hi=5e307;
 for(const reverse of [false,true]){
  const [min,max]=reverse?[hi,lo]:[lo,hi],descending=reverse;
  expect(dataBar({...base,barMode},-1.7e308,min,max).bar).toBeCloseTo(descending?.6:.1);
  expect(dataBar({...base,barMode},1e308,min,max).bar).toBeCloseTo(descending?.1:.6);
 }
});
it.each(['legacy','extended'])('%s interpolates finite spans and clips overflowing numerators',barMode=>{
 for(const reverse of [false,true]){
  const [min,max]=reverse?[8e307,-8e307]:[-8e307,8e307],descending=reverse;
  for(const [value,fraction] of [[-1.7e308,0],[-8e307,0],[-4e307,.25],[0,.5],[4e307,.75],[8e307,1],[1.7e308,1]]){
   expect(dataBar({...base,barMode},value,min,max).bar).toBeCloseTo(.1+.5*(descending?1-fraction:fraction),14);
  }
 }
});
it('keeps app-authored bars mathematically scaled over extreme domains',()=>{
 for(const [value,fraction] of [[-1e308,0],[-5e307,.25],[0,.5],[5e307,.75],[1e308,1]]){
  expect(dataBar({type:'databar'},value,-1e308,1e308).bar).toBe(fraction);
 }
});

const look=(wb,r,c=2)=>wb.conditionalStyle(wb.activeSheetId,r,c,wb.getValue(wb.activeSheetId,r,c));
const nativeRoundtrip=async wb=>{
 const zip=X.CFB.read(new Uint8Array(await(await workbookToXlsx(wb)).arrayBuffer()),{type:'array'});
 const part=X.CFB.find(zip,'/xl/workbook.xml');
 part.content=new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g,''));part.size=part.content.length;
 return workbookFromFile(X.CFB.write(zip,{type:'array',fileType:'zip'}),'native-bars.xlsx');
};
it.each(['legacy','extended'])('%s preserves live overflowing formula bounds through native saves and copies',async barMode=>{
 let wb=new Workbook(),id=wb.activeSheetId;
 wb.setInput(id,0,0,'-1.5e308');wb.setInput(id,1,0,'5e307');
 const values=[-1.7e308,-1.5e308,-8e307,0,5e307,8e307,1.7e308];
 values.forEach((v,i)=>wb.setInput(id,i+2,2,String(v)));
 wb.addRule(id,{...base,barMode,range:{r1:2,c1:2,r2:8,c2:2},barMinFormula:'$A$1',barMaxFormula:'$A$2'});
 const expected=[.1,.35,.35,.35,.35,.6,.6];
 for(let pass=0;pass<2;pass++){
  wb=await nativeRoundtrip(wb);id=wb.activeSheetId;
  expected.forEach((n,i)=>expect(look(wb,i+2).bar).toBeCloseTo(n,14));
 }
 const rows=[3,4,5,6,7];
 wb.pasteCells(id,wb.copyCells(id,rows,[2]),10,5,{r:3,c:2},null,{conditionalFormats:wb.copyConditionalFormats(id,rows,[2])});
 for(let i=0;i<rows.length;i++)expect(look(wb,i+10,5).bar).toBeCloseTo(expected[i+1],14);
 wb.setInput(id,0,0,'-5e307');
 expect(look(wb,5).bar).toBeCloseTo(.35,14);expect(look(wb,4).bar).toBeCloseTo(.1,14);
 expect(look(wb,11,5).bar).toBeCloseTo(.1,14);
 wb.undo();expect(look(wb,11,5).bar).toBeCloseTo(.35,14);
});
