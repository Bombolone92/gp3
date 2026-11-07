import {expect,it} from 'vitest';
import {shiftFormula} from '../src/core/refs.js';
import {Workbook} from '../src/core/workbook.js';
import {workbookFromFile,workbookToXlsx,workbookToOds} from '../src/core/io.js';
function setup(external=false,formula=null) {
  const data={name:'Data',cells:Object.fromEntries(Array.from({length:10},(_,r)=>[`${r},1`,{v:r%3===0?9:3}]))};
  const owner=external?{name:'Report',protected:true}:data;
  owner.cells={...owner.cells,'1,0':{v:'Header'},...Object.fromEntries(Array.from({length:6},(_,i)=>[`${i+2},0`,{v:i+2}]))};
  owner.filter={range:{r1:1,c1:0,r2:7,c2:0},criteria:{0:{formula:formula||`${external?'Data!':''}B4>5`}},showButtons:false};
  const wb=new Workbook({sheets:external?[data,owner]:[data]});return{wb,id:wb.sheets.at(-1).id,sourceId:wb.sheets[0].id};
}
const mapped=(r,at,n,remove)=>r<at?r:!remove?r+n:r<at+n?null:r-n;
it.each([false,true].flatMap(remove=>[false,true].map(external=>[remove,external])))('keeps filter references and visibility on row edits (delete=%s, external=%s)',(remove,external)=>{
  const {wb,id,sourceId}=setup(external);const before=wb.toJSON();
  wb[remove?'deleteRows':'insertRows'](sourceId,4,2);
  const check=()=>{for(let old=2;old<=7;old++){
    const r=external?old:mapped(old,4,2,remove);if(r==null)continue;
    const keep=mapped(old+1,4,2,remove)!=null&&(old+1)%3===0;
    expect(wb.sheet(id).filterHidden.has(r),`row ${old}`).toBe(!keep);
  }};
  check();const after=wb.toJSON();wb.undo();expect(wb.toJSON()).toEqual(before);wb.redo();expect(wb.toJSON()).toEqual(after);check();
  expect(wb.sheet(id).filter.showButtons).toBe(false);
});
it.each([false,true])('follows shifted columns (delete=%s)',remove=>{
  const {wb,id}=setup(false,'C3>5');for(let r=2;r<=7;r++)wb.setInput(id,r,2,r%2?'9':'3');wb.reapplyFilter(id);
  wb[remove?'deleteCols':'insertCols'](id,1,1);
  expect([...wb.sheet(id).filterHidden]).toEqual([2,4,6]);
});
it.each([0,1,2])('handles deletion around the header and first data row at %s',at=>{
  const {wb,id}=setup();wb.deleteRows(id,at,1);
  const f=wb.sheet(id).filter;
  for(let r=f.range.r1+1;r<=f.range.r2;r++) {
    const old=r>=at?r+1:r;expect(wb.sheet(id).filterHidden.has(r)).toBe((old+1)%3!==0);
  }
});
it('fills filter coverage when inserting the first data rows',()=>{
  const {wb,id}=setup(false,'A3>0');wb.insertRows(id,2,2);
  // The rows just inserted stay in view to be filled in; the filter takes them when it next runs.
  expect(wb.sheet(id).filterHidden.has(2)).toBe(false);expect(wb.sheet(id).filterHidden.has(3)).toBe(false);
  wb.reapplyFilter(id);
  expect(wb.sheet(id).filterHidden.has(2)).toBe(true);expect(wb.sheet(id).filterHidden.has(3)).toBe(true);
  for(let r=4;r<=9;r++)expect(wb.sheet(id).filterHidden.has(r)).toBe(false);
});
it('reapplies dependent filters when referenced cell formulas move',()=>{
  const {wb,id,sourceId}=setup(true,'Data!B3>5');wb.defineName('Options','Data!B3:B8');
  wb.sheet(id).filter.criteria[0].formula='INDEX(Options,ROW()-2)>5';wb.reapplyFilter(id);
  const hidden=[...wb.sheet(id).filterHidden];wb.insertRows(sourceId,0,2);
  expect([...wb.sheet(id).filterHidden]).toEqual(hidden);
});
it.each(['xlsx','ods'])('retains adjusted filter behavior on %s reopening',async format=>{
  const {wb,id}=setup();wb.insertRows(id,0,2);
  const copy=await workbookFromFile(await(format==='xlsx'?workbookToXlsx(wb):workbookToOds(wb)),`saved.${format}`);
  expect([...copy.sheets[0].filterHidden]).toEqual([5,6,8,9]);
});
function addOracle(wb,id) {
  const s=wb.sheet(id),f=s.filter;
  for(let r=f.range.r1+1;r<=f.range.r2;r++)s.cells.set(`${r},10`,{f:shiftFormula(f.criteria[0].formula,r-f.range.r1-1,0)});
  wb._invalidate();wb.reapplyFilter(id);
}
function checkOracle(wb,id,col=10) {
  const s=wb.sheet(id),f=s.filter;
  for(let r=f.range.r1+1;r<=f.range.r2;r++) {
    if(!wb.getCell(id,r,col)?.f)continue;
    const v=wb.getValue(id,r,col),keep=v===true||(typeof v==='number'&&v!==0);
    expect(s.filterHidden.has(r),`row ${r}, oracle ${JSON.stringify(v)}`).toBe(!keep);
  }
}
it.each([false,true])('tracks repeated edits against ordinary cell formulas (external=%s)',external=>{
  const {wb,id,sourceId}=setup(external);addOracle(wb,id);
  wb.insertRows(sourceId,4,2);checkOracle(wb,id);
  wb.deleteRows(sourceId,0,1);checkOracle(wb,id);
  wb.insertCols(sourceId,1,1);checkOracle(wb,id,external?10:11);
  wb.deleteRows(sourceId,4,2);checkOracle(wb,id,external?10:11);
  wb.renameSheet(sourceId,'Changed Data');
  wb.insertRows(sourceId,3,1);checkOracle(wb,id,external?10:11);
});
it('keeps later references above the filter intact and preserves an unchanged UI save',()=>{
  const {wb,id,sourceId}=setup(true,'Data!B1>5');addOracle(wb,id);
  wb.deleteRows(sourceId,0,1);checkOracle(wb,id);
  const s=wb.sheet(id),criterion=s.filter.criteria[0];
  expect(criterion.formula).toContain('INDIRECT');
  for(let r=2;r<=7;r++) {
    const result=wb.evalRuleFormula(id,criterion.formula,{r1:2,c1:0},r,0);
    expect(result===true).toBe(!s.filterHidden.has(r));
  }
  wb.setFilterCriteria(id,0,{formula:criterion.formula});
  expect(wb.sheet(id).filter.criteria[0].formulaParts).toBeDefined();
  wb.insertRows(sourceId,1,2);checkOracle(wb,id);
});
it('refreshes dependent filters after a source formula changes with its row',()=>{
  const wb=new Workbook({sheets:[{name:'Data',cells:{'1,1':{f:'ROW()'}}},{name:'Report',cells:{'0,0':{v:'Value'},'1,0':{v:'One'}},filter:{range:{r1:0,c1:0,r2:1,c2:0},criteria:{0:{formula:'Data!B2>2'}}}}]}),id=wb.sheets[1].id;
  expect([...wb.sheet(id).filterHidden]).toEqual([1]);wb.insertRows(wb.sheets[0].id,0,1);
  expect([...wb.sheet(id).filterHidden]).toEqual([]);
});
it.each(['xlsx','ods'])('retains split intervals after %s reopening and another edit',async format=>{
  let {wb,id}=setup();addOracle(wb,id);wb.insertRows(id,4,2);
  wb=await workbookFromFile(await(format==='xlsx'?workbookToXlsx(wb):workbookToOds(wb)),`saved.${format}`);id=wb.sheets[0].id;
  checkOracle(wb,id);wb.deleteRows(id,0,1);checkOracle(wb,id);
});
it('keeps split references live in a copied sheet',()=>{
  const {wb,id}=setup();addOracle(wb,id);wb.insertRows(id,4,2);
  const copy=wb.duplicateSheet(id);wb.insertRows(copy.id,0,1);checkOracle(wb,copy.id);
  expect(wb.sheet(id).filter.range.r1).toBe(1);
});
it('ignores malformed interval metadata and uses edited formulas',()=>{
  const {wb,id}=setup();const s=wb.sheet(id);
  s.filter.criteria[0].formulaParts={formula:s.filter.criteria[0].formula,parts:[null]};
  expect(()=>wb.reapplyFilter(id)).not.toThrow();
  wb.insertRows(id,4,2);
  wb.setFilterCriteria(id,0,{formula:'A3<0'});
  expect(wb.sheet(id).filter.criteria[0].formulaParts).toBeUndefined();
  for(let r=2;r<=9;r++)expect(wb.sheet(id).filterHidden.has(r)).toBe(true);
});
it('updates table-column references in every retained interval',()=>{
  const {wb,id}=setup(false,'AND(B4>5,SUM(Items[Amount])>0)');
  wb.setInput(id,0,6,'Amount');wb.setInput(id,0,7,'Label');wb.setInput(id,1,6,'1');wb.setInput(id,2,6,'2');
  const filter=wb.sheet(id).filter;wb.addTable(id,{r1:0,c1:6,r2:2,c2:7},{name:'Items'});wb.sheet(id).filter=filter;addOracle(wb,id);
  wb.insertRows(id,4,2);checkOracle(wb,id);
  wb.setInput(id,0,6,'Price');
  expect(wb.sheet(id).filter.criteria[0].formulaParts.parts.every(p=>p.source.includes('Items[Price]'))).toBe(true);
  wb.insertRows(id,0,1);checkOracle(wb,id);
});
it('validates interval metadata once per filter pass',()=>{
  const {wb,id}=setup();wb.sheet(id).filter.range.r2=500;wb.insertRows(id,4,2);
  const parts=wb.sheet(id).filter.criteria[0].formulaParts?.parts;if(!parts)return;let reads=0;
  for(const p of parts){const source=p.source;Object.defineProperty(p,'source',{get(){reads++;return source;},enumerable:true});}
  wb.reapplyFilter(id);
  expect(reads).toBeLessThanOrEqual(501+parts.length*2);
});
it.each(['insert-own','insert-other','delete-other'])('preserves header-only filters during %s edits',action=>{
  const wb=new Workbook({sheets:[{name:'Data',filter:{range:{r1:2,c1:0,r2:2,c2:0},criteria:{}}},{name:'Other'}]}),id=wb.sheets[0].id;
  if(action==='insert-own')wb.insertRows(id,0,1);
  else wb[action==='insert-other'?'insertRows':'deleteRows'](wb.sheets[1].id,0,1);
  expect(wb.sheet(id).filter).toMatchObject({range:{r1:action==='insert-own'?3:2,r2:action==='insert-own'?3:2},criteria:{}});
});
