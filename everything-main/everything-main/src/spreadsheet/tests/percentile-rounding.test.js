import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
const oracle=JSON.parse(readFileSync(new URL('./fixtures/reference-percentile-rounding.json',import.meta.url),'utf8'));
const functions=['PERCENTILE','PERCENTILE.INC','AGGREGATE'];
function setup() {
 const w=new Workbook(),id=w.activeSheetId;
 [0,100].forEach((v,r)=>w.setInput(id,r,0,String(v)));
 [0,25,100].forEach((v,r)=>w.setInput(id,r,1,String(v)));
 oracle.cases.forEach(({probability},r)=>{
  w.setInput(id,r,2,String(probability));
  for(let c=0;c<6;c++){
   const source=c<3?'$A$1:$A$2':'$B$1:$B$3',fn=functions[c%3];
   w.setInput(id,r,c+3,`=${fn}(${fn==='AGGREGATE'?'16,6,':''}${source},C${r+1})`);
  }
 });
 return w;
}
const check=w=>oracle.cases.forEach(({two,three},r)=>{
 for(let c=0;c<6;c++)expect(w.getValue(w.activeSheetId,r,c+3)).toBe(c<3?two:three);
});
it('interpolates at fractional ranks and ranks rounded onto an endpoint',()=>check(setup()));
it('retains stored probabilities, copied formulas and interpolation through XLSX export',async()=>{
 let w=setup(),id=w.activeSheetId;
 const cells=w.copyRange(id,{r1:0,c1:2,r2:oracle.cases.length-1,c2:8});
 w.pasteCells(id,cells,15,2,{r:0,c:2});
 w=await workbookFromFile(new Uint8Array(await(await workbookToXlsx(w)).arrayBuffer()),'percentile.xlsx');
 check(w);id=w.activeSheetId;
 oracle.cases.forEach(({two,three},r)=>{
  for(let c=0;c<6;c++)expect(w.getValue(id,r+15,c+3)).toBe(c<3?two:three);
 });
 w.setInput(id,1,0,'200');expect(w.getValue(id,1,3)).toBe(66.6666666666667);
 w.undo();check(w);
});
