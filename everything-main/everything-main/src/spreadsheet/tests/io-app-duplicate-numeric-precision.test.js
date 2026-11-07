import {expect,it} from 'vitest';
import {Workbook} from '../src/core/workbook.js';
import {workbookFromFile,workbookToXlsx} from '../src/core/io.js';
import {conditionalRuleFormula} from '../src/core/condformat-formula.js';
import * as X from '../src/vendor/xlsx.mjs';

const cases=[
 ['unit',[1,1.000000000000001,1],[true,false,true]],
 ['negative',[-1,-1.000000000000001,-1],[true,false,true]],
 ['large',[1e200,1.000000000000001e200,1e200],[true,false,true]],
 ['small',[1e-200,1.000000000000001e-200,1e-200],[true,false,true]],
 ['arithmetic',[{f:'1.1*3'},3.3,{f:'1.1*3'}],[true,false,true]],
 ['typed',[1,'1',true,1],[true,false,false,true]],
 ['zeros',[0,-0,'0',false],[true,true,false,false]],
];
async function external(wb){
 const zip=X.CFB.read(new Uint8Array(await(await workbookToXlsx(wb)).arrayBuffer()),{type:'array'});
 const part=X.CFB.find(zip,'/xl/workbook.xml');
 part.content=new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g,''));
 part.size=part.content.length;
 return workbookFromFile(X.CFB.write(zip,{type:'array',fileType:'zip'}),'external.xlsx');
}
it.each(cases)('keeps app-authored numeric duplicate identities after native-only export: %s',async(_label,values,duplicates)=>{
 for(const type of ['dup','unique']){
  let wb=new Workbook(),id=wb.activeSheetId;
  wb.setCells(id,values.map((v,r)=>({r,c:2,cell:typeof v==='object'?v:{v}})));
  const rule={type,range:{r1:0,c1:2,r2:values.length-1,c2:2},style:{bg:'#b6e6ad'}};
  wb.addRule(id,rule);
  const expected=duplicates.map(v=>type==='dup'?v:!v);
  const read=()=>values.map((_,r)=>!!wb.conditionalStyle(id,r,2,wb.getValue(id,r,2))?.bg);
  expect(read()).toEqual(expected);
  expect(values.map((_,r)=>wb.evalRuleFormula(id,conditionalRuleFormula(rule),rule.range,r,2))).toEqual(expected);
  for(let pass=0;pass<2;pass++){
   wb=await external(wb);id=wb.activeSheetId;expect(read()).toEqual(expected);
  }
  wb.setInput(id,1,2,'99');wb.undo();expect(read()).toEqual(expected);
  const copy=new Workbook(),[sheet]=copy.importSheets(wb);
  expect(values.map((_,r)=>!!copy.conditionalStyle(sheet.id,r,2,copy.getValue(sheet.id,r,2))?.bg)).toEqual(expected);
 }
});
it('filters numeric cells across multiple columns and sparse whole-column sources',()=>{
 const wb=new Workbook(),id=wb.activeSheetId;
 wb.setCells(id,[{r:0,c:0,cell:{v:1}},{r:9000,c:0,cell:{v:1.000000000000001}},{r:2,c:1,cell:{v:1}}]);
 for(const range of [{r1:0,c1:0,r2:9000,c2:1},{r1:0,c1:0,r2:1048575,c2:0}]){
  const formula=conditionalRuleFormula({type:'unique',range});
  expect(wb.evalRuleFormula(id,formula,range,9000,0)).toBe(true);
  expect(wb.evalRuleFormula(id,formula,range,0,0)).toBe(range.c2===0);
 }
});
