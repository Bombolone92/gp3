import {expect,it} from 'vitest';
import {MAX_ROW,MAX_COL} from '../src/core/refs.js';
import {Workbook} from '../src/core/workbook.js';
import {workbookFromFile,workbookToXlsx,workbookToOds} from '../src/core/io.js';
function setup(external=false,formula=null) {
  const data={name:'Data',cells:Object.fromEntries(Array.from({length:12},(_,r)=>[`${r},4`,{v:r%3===0?9:3}]))};
  const owner=external?{name:'Report',protected:true}:data;
  owner.cells={...owner.cells,'2,2':{v:'Header'},...Object.fromEntries(Array.from({length:6},(_,i)=>[`${i+3},2`,{v:i+3}]))};
  owner.filter={range:{r1:2,c1:2,r2:8,c2:3},criteria:{2:{formula:formula||`${external?'Data!':''}E5>5`}},showButtons:false};
  const wb=new Workbook({sheets:external?[data,owner]:[data]});return{wb,id:wb.sheets.at(-1).id,sourceId:wb.sheets[0].id};
}
const map=(p,at,n,remove)=>p<at?p:!remove?p+n:p<at+n?null:p-n;
it.each(['row','col'].flatMap(axis=>[false,true].flatMap(remove=>[false,true].map(external=>[axis,remove,external]))))('retains filter references through %s blocks (delete=%s, external=%s)',(axis,remove,external)=>{
  const {wb,id,sourceId}=setup(external),row=axis==='row';const before=wb.toJSON();
  const block=row?{r1:5,c1:2,r2:6,c2:4}:{r1:2,c1:1,r2:8,c2:1};
  expect(wb[remove?'deleteCells':'insertCells'](sourceId,block,row?(remove?'up':'down'):(remove?'left':'right'))).toBe(true);
  const check=()=>{for(let old=3;old<=8;old++){
    const r=external||!row?old:map(old,5,2,remove);if(r==null)continue;
    const keep=(!row||map(old+1,5,2,remove)!=null)&&(old+1)%3===0;
    expect(wb.sheet(id).filterHidden.has(r),`old row ${old}`).toBe(!keep);
  }};
  check();const after=wb.toJSON();wb.undo();expect(wb.toJSON()).toEqual(before);wb.redo();expect(wb.toJSON()).toEqual(after);check();
  expect(wb.sheet(id).filter.showButtons).toBe(false);
});
it.each(['row','col'].flatMap(axis=>[false,true].map(remove=>[axis,remove])))('keeps a self-referencing criterion aligned when the filter spans a %s block (delete=%s)',(axis,remove)=>{
  const {wb,id}=setup(false,'C4>0');
  for(let r=3;r<=8;r++)wb.setInput(id,r,3,String(20+r));
  const range={...wb.sheet(id).filter.range};
  wb[remove?'deleteCells':'insertCells'](id,axis==='row'?{r1:3,c1:2,r2:4,c2:2}:{r1:5,c1:2,r2:6,c2:2},axis==='row'?(remove?'up':'down'):(remove?'left':'right'));
  expect(wb.sheet(id).filter.range).toEqual(range);
  for(let r=3;r<=8;r++)expect(wb.sheet(id).filterHidden.has(r)).toBe(!(wb.getValue(id,r,2)>0));
});
it.each(['row','col'])('continues the criterion on replacement cells when a %s block deletes every data target',axis=>{
  const {wb,id}=setup(false,'C4>0');for(let r=3;r<=10;r++)wb.setInput(id,r,3,String(20+r));
  wb.setInput(id,9,2,'30');wb.setInput(id,10,2,'31');
  wb.deleteCells(id,axis==='row'?{r1:3,c1:2,r2:8,c2:2}:{r1:3,c1:2,r2:8,c2:2},axis==='row'?'up':'left');
  for(let r=3;r<=8;r++)expect(wb.sheet(id).filterHidden.has(r)).toBe(!(wb.getValue(id,r,2)>0));
});
it('refreshes dependent color and value filters after source formulas move',()=>{
  const wb=new Workbook({sheets:[{name:'Data',cells:{'1,1':{f:'ROW()'}}},{name:'Colors',cells:{'0,0':{v:'Header'},'1,0':{v:'One'}},rules:[{type:'formula',value:'Data!B2>2',range:{r1:1,c1:0,r2:1,c2:0},style:{bg:'#ff0000'}}],filter:{range:{r1:0,c1:0,r2:1,c2:0},criteria:{0:{color:'#ff0000'}}}},{name:'Values',cells:{'0,0':{v:'Header'},'1,0':{f:'Data!B2'}},filter:{range:{r1:0,c1:0,r2:1,c2:0},criteria:{0:{values:['3']}}}}]});
  for(const s of wb.sheets.slice(1))expect([...s.filterHidden]).toEqual([1]);
  wb.insertCells(wb.sheets[0].id,{r1:0,c1:1,r2:0,c2:1},'down');
  for(const s of wb.sheets.slice(1))expect([...s.filterHidden]).toEqual([]);
});
it.each(['xlsx','ods'])('keeps adjusted block filters through %s reopening',async format=>{
  let {wb,id}=setup();wb.insertCells(id,{r1:5,c1:2,r2:6,c2:4},'down');
  wb=await workbookFromFile(await(format==='xlsx'?workbookToXlsx(wb):workbookToOds(wb)),`saved.${format}`);
  const s=wb.sheets[0];expect(s.filterHidden.has(7)).toBe(false);expect(s.filterHidden.has(8)).toBe(true);
});
it('preserves split formulas across repeated whole-line and block edits and renames',()=>{
  const {wb,id,sourceId}=setup(true),oracle=wb.addSheet('Oracle');
  for(let r=3;r<=8;r++)wb.setInput(oracle.id,r-3,0,`=Data!E${r+2}>5`);
  const check=()=>{for(let r=3;r<=8;r++)expect(wb.sheet(id).filterHidden.has(r)).toBe(wb.getValue(oracle.id,r-3,0)!==true);};
  wb.insertRows(sourceId,5,2);check();
  wb.insertCells(sourceId,{r1:4,c1:4,r2:4,c2:4},'down');check();
  wb.insertCells(sourceId,{r1:4,c1:1,r2:6,c2:1},'right');check();
  wb.deleteRows(sourceId,0,1);check();
  wb.renameSheet(sourceId,'Changed Data');
  wb.deleteCells(sourceId,{r1:4,c1:5,r2:5,c2:5},'up');check();
  const c=wb.sheet(id).filter.criteria[2];wb.setFilterCriteria(id,2,{formula:c.formula});
  wb.insertCells(sourceId,{r1:1,c1:4,r2:1,c2:5},'down');check();
});
it.each(['xlsx','ods'])('retains partial-filter patterns after %s reopening and another edit',async format=>{
  let {wb,id}=setup(false,'C4>0');for(let r=3;r<=8;r++)wb.setInput(id,r,3,String(20+r));
  wb.deleteCells(id,{r1:5,c1:2,r2:6,c2:2},'left');
  wb=await workbookFromFile(await(format==='xlsx'?workbookToXlsx(wb):workbookToOds(wb)),`saved.${format}`);id=wb.sheets[0].id;
  wb.insertCells(id,{r1:4,c1:2,r2:5,c2:2},'down');
  for(let r=3;r<=8;r++)expect(wb.sheet(id).filterHidden.has(r)).toBe(!(wb.getValue(id,r,2)>0));
});
it.each(['own','other'])('preserves header-only filters during block insertion on %s sheet',target=>{
  const wb=new Workbook({sheets:[{name:'Data',filter:{range:{r1:2,c1:0,r2:2,c2:0},criteria:{}}},{name:'Other'}]}),id=wb.sheets[0].id;
  wb.insertCells(target==='own'?id:wb.sheets[1].id,{r1:0,c1:0,r2:0,c2:0},'down');
  expect(wb.sheet(id).filter).toMatchObject({range:{r1:target==='own'?3:2,r2:target==='own'?3:2},criteria:{}});
});
it('keeps absolute deleted references invalid while continuing relative replacement patterns',()=>{
  const {wb,id}=setup(false,'AND(C4>0,$C$4>0)');for(let r=3;r<=8;r++)wb.setInput(id,r,3,String(20+r));
  wb.deleteCells(id,{r1:3,c1:2,r2:8,c2:2},'left');
  for(let r=3;r<=8;r++)expect(wb.sheet(id).filterHidden.has(r)).toBe(true);
});
it.each(['row','col'])('continues blank-cell predicates at the %s file boundary',axis=>{
  const row=axis==='row',first=row?MAX_ROW-1:1,col=row?2:MAX_COL;
  const wb=new Workbook({sheets:[{name:'Data',rows:row?MAX_ROW+1:3,cols:row?4:MAX_COL+1,
    cells:{[`${first},${col}`]:{v:9},[`${first+1},${col}`]:{v:9}},
    filter:{range:{r1:first-1,c1:row?2:MAX_COL-1,r2:first+1,c2:row?3:MAX_COL},criteria:{[col]:{formula:`ISBLANK(${row?'C':'XFD'}${first+1})`}}}}]}),id=wb.activeSheetId;
  expect([...wb.sheet(id).filterHidden]).toEqual([first,first+1]);
  wb.deleteCells(id,{r1:first,c1:col,r2:first+1,c2:col},row?'up':'left');
  expect([...wb.sheet(id).filterHidden]).toEqual([]);
});
it('normalizes reversed mixed references when deriving replacement-row predicates',()=>{
  const {wb,id}=setup(false,'SUM($C$5:C4)>0');wb.setInput(id,9,2,'30');wb.setInput(id,10,2,'31');
  for(let r=3;r<=8;r++)wb.setInput(id,r,10,`=SUM($C$5:C${r+7})>0`);
  wb.deleteCells(id,{r1:3,c1:2,r2:8,c2:2},'up');
  for(let r=3;r<=8;r++)expect(wb.sheet(id).filterHidden.has(r)).toBe(wb.getValue(id,r,10)!==true);
});
it('keeps clipped relative endpoints correct across replacement rows',()=>{
  const {wb,id}=setup(false,'SUM(C1:C4)=D4');wb.setInput(id,9,2,'30');wb.setInput(id,10,2,'31');
  for(let r=3;r<=8;r++) {
    wb.setInput(id,r+6,3,r===3?'30':'61');
    wb.setInput(id,r,10,`=SUM(C${r+4}:C${r+7})=D${r+7}`);
  }
  wb.deleteCells(id,{r1:3,c1:2,r2:8,c2:2},'up');
  for(let r=3;r<=8;r++)expect(wb.sheet(id).filterHidden.has(r)).toBe(wb.getValue(id,r,10)!==true);
});
