import {expect,it} from 'vitest';
import {Workbook} from '../src/core/workbook.js';
import {cellName} from '../src/core/cell.js';
import {shiftFormula,MAX_ROW} from '../src/core/refs.js';
import {workbookFromFile,workbookToXlsx,workbookToOds} from '../src/core/io.js';
function setup(axis,external=false,type='formula') {
  const row=axis==='row',range=row?{r1:2,c1:0,r2:6,c2:2}:{r1:0,c1:2,r2:2,c2:6};
  const cells={};for(let r=0;r<12;r++)for(let c=0;c<12;c++)cells[`${r},${c}`]={v:100+r*10+c};
  const data={name:'Data',cells},owner=external?{name:'Checks',cells:{...cells},protected:true}:data;
  const source=(external?'Data!':'')+cellName(range.r1+1,range.c1+1);
  const formula=`${cellName(range.r1,range.c1)}+11=${source}`;
  owner.validations=[{id:'validation',range,type,source:type==='list'?'='+source:formula,relativeSource:type==='list',strict:true}];
  owner.rules=[{id:'format',range,type:'formula',value:formula,style:{bold:true}}];
  const wb=new Workbook({sheets:external?[data,owner]:[data]});return{wb,id:wb.sheets.at(-1).id,sourceId:wb.sheets[0].id,range,row};
}
const map=(index,at,remove)=>index<at?index:!remove?index+2:index<at+2?null:index-2;
it.each(['row','col'].flatMap(axis=>[false,true].flatMap(remove=>[false,true].map(external=>[axis,remove,external]))))('keeps rules across %s block shifts (delete=%s, external=%s)',(axis,remove,external)=>{
  const {wb,id,sourceId,range,row}=setup(axis,external),before=wb.toJSON();
  const block=row?{r1:4,c1:0,r2:5,c2:1}:{r1:0,c1:4,r2:1,c2:5};
  expect(wb[remove?'deleteCells':'insertCells'](sourceId,block,row?(remove?'up':'down'):(remove?'left':'right'))).toBe(true);
  const check=()=>{
    for(let r=range.r1;r<=range.r2;r++)for(let c=range.c1;c<=range.c2;c++) {
      const axisPos=row?r:c,other=row?c:r;
      const target=external||other>1?axisPos:map(axisPos,4,remove);if(target==null)continue;
      const rr=row?target:r,cc=row?c:target;
      const sourceKept=other+1>1||map(axisPos+1,4,remove)!=null;
      expect(wb.validationAt(id,rr,cc),`${r},${c}`).not.toBeNull();
      expect(wb.validateValue(id,rr,cc,100+r*10+c).ok,`${r},${c}`).toBe(sourceKept);
      expect(!!wb.conditionalStyle(id,rr,cc,wb.getValue(id,rr,cc))?.bold,`${r},${c}`).toBe(sourceKept);
    }
  };
  check();const after=wb.toJSON();wb.undo();expect(wb.toJSON()).toEqual(before);wb.redo();expect(wb.toJSON()).toEqual(after);check();
});
it.each(['row','col'].flatMap(axis=>[false,true].map(remove=>[axis,remove])))('preserves relative dropdowns across %s block shifts (delete=%s)',(axis,remove)=>{
  const {wb,id,range,row}=setup(axis,false,'list');
  wb[remove?'deleteCells':'insertCells'](id,row?{r1:4,c1:0,r2:5,c2:1}:{r1:0,c1:4,r2:1,c2:5},row?(remove?'up':'down'):(remove?'left':'right'));
  for(let r=range.r1;r<=range.r2;r++)for(let c=range.c1;c<=range.c2;c++) {
    const axisPos=row?r:c,other=row?c:r,target=other>1?axisPos:map(axisPos,4,remove);if(target==null)continue;
    expect(wb.validateValue(id,row?target:r,row?c:target,111+r*10+c).ok).toBe(other+1>1||map(axisPos+1,4,remove)!=null);
  }
});
it.each([false,true])('retains fixed list sources and literal options (delete=%s)',remove=>{
  const {wb,id}=setup('row');const s=wb.sheet(id);
  s.validations=[{id:'fixed',type:'list',source:'B3:B4',range:{r1:5,c1:0,r2:7,c2:2}},{id:'literal',type:'list',source:['A1:B2','Blue'],range:{r1:8,c1:0,r2:9,c2:2}}];
  wb[remove?'deleteCells':'insertCells'](id,{r1:0,c1:1,r2:1,c2:1},remove?'up':'down');
  expect(wb.listOptionsFor(id,wb.validationAt(id,5,0))).toEqual(['121','131']);
  expect(wb.validationAt(id,8,0).source).toEqual(['A1:B2','Blue']);
});
it('grows the sheet for the shifted part of a sparse wide rule',()=>{
  const wb=new Workbook({sheets:[{name:'Data',rows:100,validations:[{type:'number',min:0,range:{r1:2,c1:0,r2:19999,c2:10}}]}]}),id=wb.activeSheetId;
  expect(wb.insertCells(id,{r1:2,c1:5,r2:3,c2:5},'down')).toBe(true);
  expect(wb.activeSheet.rows).toBeGreaterThanOrEqual(20002);expect(wb.activeSheet.cells.size).toBe(0);
  expect(wb.validationAt(id,20001,5)).not.toBeNull();expect(wb.validationAt(id,20001,4)).toBeNull();
  expect(wb.activeSheet.validations.length).toBeLessThanOrEqual(3);
});
it('leaves a rule that already reaches the file limit anchored there on insertion',()=>{
  const wb=new Workbook({sheets:[{name:'Data',validations:[{type:'number',min:0,range:{r1:0,c1:0,r2:MAX_ROW,c2:3}}]}]}),id=wb.activeSheetId;
  expect(wb.insertCells(id,{r1:2,c1:1,r2:2,c2:1},'down')).toBe(true);
  for(const r of [0,2,3,MAX_ROW]) expect(wb.validationAt(id,r,1)).not.toBeNull();
  expect(Math.max(...wb.activeSheet.validations.map(v=>v.range.r2))).toBe(MAX_ROW);
});
it('refuses insertion that would push a stored cell beyond the file limit',()=>{
  const wb=new Workbook({sheets:[{name:'Data',rows:MAX_ROW+1,cells:{[`${MAX_ROW},1`]:{v:7}},validations:[{type:'number',min:0,range:{r1:0,c1:0,r2:MAX_ROW,c2:3}}]}]}),id=wb.activeSheetId,before=wb.toJSON();
  expect(wb.insertCells(id,{r1:2,c1:1,r2:2,c2:1},'down')).toBe(false);expect(wb.toJSON()).toEqual(before);
});
it.each(['xlsx','ods'])('retains adjusted block rules after %s reopening',async format=>{
  let {wb,id}=setup('row');wb.insertCells(id,{r1:4,c1:0,r2:5,c2:1},'down');
  wb=await workbookFromFile(await(format==='xlsx'?workbookToXlsx(wb):workbookToOds(wb)),`saved.${format}`);id=wb.sheets[0].id;
  expect(wb.validateValue(id,6,0,140).ok).toBe(true);expect(wb.validateValue(id,6,0,141).ok).toBe(false);
});
it('keeps literal arrays literal when a formerly relative dropdown is edited',()=>{
  const {wb,id}=setup('row',false,'list');wb.activeSheet.validations[0].source=['A1:B2','Blue'];
  wb.insertCells(id,{r1:4,c1:0,r2:5,c2:1},'down');
  expect(wb.validationAt(id,6,0).source).toEqual(['A1:B2','Blue']);
  expect(wb.validateValue(id,6,0,'Blue').ok).toBe(true);
});
it.each(['row','col'].flatMap(axis=>[false,true].map(remove=>[axis,remove])))('matches ordinary range formulas across a %s band boundary (delete=%s)',(axis,remove)=>{
  for(const fixedStart of [false,true])for(const fixedEnd of [false,true]) {
    const {wb,id,range,row}=setup(axis);
    const corner=(r,c,absolute)=>cellName(r,c).replace(row?/^[A-Z]+/:/\d+$/,m=>(absolute?'$':'')+m);
    const first=corner(row?range.r1+5:range.r1+1,row?range.c1+1:range.c1+5,fixedStart);
    const last=corner(row?range.r1+7:range.r1+2,row?range.c1+2:range.c1+7,fixedEnd);
    const source=`SUM(${first}:${last})`;
    wb.activeSheet.validations[0].source=`${cellName(range.r1,range.c1)}=${source}`;
    for(let r=range.r1;r<=range.r2;r++)for(let c=range.c1;c<=range.c2;c++)wb.activeSheet.cells.set(`${30+r},${30+c}`,{f:shiftFormula(source,r-range.r1,c-range.c1)});
    wb._invalidate();
    const block=row?{r1:6,c1:1,r2:7,c2:2}:{r1:1,c1:6,r2:2,c2:7};
    wb[remove?'deleteCells':'insertCells'](id,block,row?(remove?'up':'down'):(remove?'left':'right'));
    for(let r=range.r1;r<=range.r2;r++)for(let c=range.c1;c<=range.c2;c++) {
      const other=row?c:r,pos=row?r:c,target=other>=1&&other<=2?map(pos,6,remove):pos;if(target==null)continue;
      const expected=wb.getValue(id,30+r,30+c),rr=row?target:r,cc=row?c:target;
      expect(wb.validateValue(id,rr,cc,typeof expected==='number'?expected:0).ok,JSON.stringify({axis,remove,fixedStart,fixedEnd,r,c,expected})).toBe(typeof expected==='number');
    }
  }
});
it('keeps unique IDs, overlap precedence, and behavior after an inverse block edit',()=>{
  const {wb,id,range}=setup('row');wb.addValidation(id,{type:'number',max:0,range:{r1:3,c1:1,r2:6,c2:1}});
  const block={r1:4,c1:0,r2:5,c2:1};wb.insertCells(id,block,'down');
  expect(wb.validateValue(id,7,1,-1).ok).toBe(true);expect(wb.validateValue(id,7,1,1).ok).toBe(false);
  wb.deleteCells(id,block,'up');
  for(let r=range.r1;r<=range.r2;r++)for(let c=range.c1;c<=range.c2;c++)expect(wb.validateValue(id,r,c,c===1&&r>=3?-1:100+r*10+c).ok).toBe(true);
  for(const rules of [wb.activeSheet.rules,wb.activeSheet.validations])expect(new Set(rules.map(r=>r.id)).size).toBe(rules.length);
});
