import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { cellName } from '../src/core/cell.js';
import { workbookFromFile, workbookToXlsx, workbookToOds } from '../src/core/io.js';
const move = (index, at, count, remove) => index < at ? index : !remove ? index + count : index < at + count ? null : index - count;
function setup(axis='row', external=false, offset=1) {
  const row=axis==='row', r=row?2:0, c=row?0:2;
  const range={r1:r,c1:c,r2:row?6:0,c2:row?0:6};
  const source=(external?'Data!':'')+cellName(row?r+offset:1,row?1:c+offset);
  const formula=`${cellName(r,c)}=${source}`;
  const data={name:'Data',cells:Object.fromEntries(Array.from({length:12},(_,i)=>[row?`${i},1`:`1,${i}`,{v:100+i}]))};
  const owner=external?{name:'Checks',protected:true}:data;
  owner.cells={...owner.cells,...Object.fromEntries(Array.from({length:5},(_,i)=>[row?`${i+2},0`:`0,${i+2}`,{v:102+i+offset}]))};
  owner.validations=[{id:'validation',type:'formula',source:formula,range,strict:true}];
  owner.rules=[{id:'format',type:'formula',value:formula,range,style:{bold:true}}];
  const wb=new Workbook({sheets:external?[data,owner]:[data]});
  return {wb,sourceId:wb.sheets[0].id,id:wb.sheets.at(-1).id,row,range,offset};
}
it.each(['row','col'].flatMap(axis=>[false,true].flatMap(remove=>[false,true].map(external=>[axis,remove,external]))))('keeps candidate references after %s edits (remove=%s, external=%s)', (axis,remove,external)=>{
  const {wb,sourceId,id,row,offset}=setup(axis,external), at=4, count=2;
  const before=wb.toJSON(); wb[row?(remove?'deleteRows':'insertRows'):(remove?'deleteCols':'insertCols')](sourceId,at,count);
  const check=()=>{
    for(let p=2;p<=6;p++) {
      const target=external?p:move(p,at,count,remove); if(target==null) continue;
      const r=row?target:0,c=row?0:target, expected=100+p+offset;
      const valid=move(p+offset,at,count,remove)!=null;
      expect(wb.validationAt(id,r,c),`candidate ${p}`).not.toBeNull();
      expect(wb.validateValue(id,r,c,expected).ok,`candidate ${p}`).toBe(valid);
      expect(wb.validateValue(id,r,c,-1).ok).toBe(false);
      expect(!!wb.conditionalStyle(id,r,c,expected)?.bold).toBe(valid);
    }
  };
  check(); const after=wb.toJSON(); wb.undo(); expect(wb.toJSON()).toEqual(before); wb.redo();expect(wb.toJSON()).toEqual(after);check();
});
it.each(['row','col'])('rebases rules when deleting their first %s',axis=>{
  const {wb,sourceId,id,row}=setup(axis);
  wb[row?'deleteRows':'deleteCols'](sourceId,2,2);
  expect(wb.validateValue(id,row?2:0,row?0:2,105).ok).toBe(true);
  expect(wb.validateValue(id,row?3:0,row?0:3,106).ok).toBe(true);
});
it.each([false,true])('updates fixed dropdown ranges after row edits (remove=%s)',remove=>{
  const wb=new Workbook({sheets:[{name:'Data',cells:{'2,1':{v:'Red'},'3,1':{v:'Blue'}},validations:[{type:'list',source:'B3:B4',range:{r1:5,c1:0,r2:8,c2:0}}]}]}),id=wb.activeSheetId;
  wb[remove?'deleteRows':'insertRows'](id,0,1);
  expect(wb.listOptionsFor(id,wb.activeSheet.validations[0])).toEqual(['Red','Blue']);
});
it.each([false,true])('follows relative dropdown references across an internal edit (remove=%s)',remove=>{
  const {wb,id}=setup(); wb.activeSheet.rules=[];
  wb.activeSheet.validations[0]={...wb.activeSheet.validations[0],type:'list',source:'=B4',relativeSource:true};
  wb[remove?'deleteRows':'insertRows'](id,4,2);
  for(let p=2;p<=6;p++) {
    const target=move(p,4,2,remove);if(target==null)continue;
    expect(wb.validateValue(id,target,0,100+p+1).ok).toBe(move(p+1,4,2,remove)!=null);
  }
});
it('keeps literal lists and ordinary conditional rules while extending inserted coverage',()=>{
  const wb=new Workbook({sheets:[{name:'Data',validations:[{type:'list',source:['A1:B2','Red'],range:{r1:0,c1:0,r2:5,c2:0}}],rules:[{type:'gt',value:2,range:{r1:0,c1:0,r2:5,c2:0},style:{bold:true}}]}]}),id=wb.activeSheetId;
  wb.insertRows(id,2,3);
  expect(wb.activeSheet.validations[0].source).toEqual(['A1:B2','Red']);
  for(let r=0;r<=8;r++)expect(wb.validationAt(id,r,0)).not.toBeNull();
  expect(wb.activeSheet.rules[0].range.r2).toBe(8);
});
it('keeps large sparse formula rules compact and covers newly inserted rows',()=>{
  const wb=new Workbook({sheets:[{name:'Data',validations:[{type:'formula',source:'A1>0',range:{r1:0,c1:0,r2:19999,c2:701}}]}]}),id=wb.activeSheetId;
  wb.insertRows(id,10000,4);
  expect(wb.activeSheet.cells.size).toBe(0);expect(wb.activeSheet.validations.length).toBeLessThanOrEqual(3);
  for(const r of [0,9999,10000,10003,10004,20003]) {expect(wb.validateValue(id,r,400,3).ok).toBe(true);expect(wb.validateValue(id,r,400,-1).ok).toBe(false);}
});
it.each(['xlsx','ods'])('preserves adjusted custom constraints after %s reopening',async format=>{
  const {wb,id}=setup();wb.insertRows(id,0,1);
  const copy=await workbookFromFile(await (format==='xlsx'?workbookToXlsx(wb):workbookToOds(wb)),`saved.${format}`);
  expect(copy.validateValue(copy.sheets[0].id,3,0,103).ok).toBe(true);
  expect(copy.validateValue(copy.sheets[0].id,3,0,104).ok).toBe(false);
});
it.each(['row','col'].flatMap(axis=>[false,true].flatMap(remove=>[false,true].map(external=>[axis,remove,external]))))('retains range endpoints across %s edits (remove=%s, external=%s)',(axis,remove,external)=>{
  const row=axis==='row';
  for(const absStart of [false,true]) for(const absEnd of [false,true]) for(const at of [1,3,5,8]) {
    const {wb,sourceId,id}=setup(axis,external), owner=wb.sheet(id);
    const endpoint=(p,absolute)=>row?`B${absolute?'$':''}${p+1}`:`${absolute?'$':''}${cellName(1,p)}`;
    owner.validations[0].source=`${row?'A3':'C1'}=SUM(${external?'Data!':''}${endpoint(1,absStart)}:${endpoint(5,absEnd)})`;
    wb[row?(remove?'deleteRows':'insertRows'):(remove?'deleteCols':'insertCols')](sourceId,at,2);
    for(let p=2;p<=6;p++) {
      const target=external?p:move(p,at,2,remove); if(target==null)continue;
      const start=absStart?1:1+p-2,end=absEnd?5:5+p-2;
      // Reversed mixed endpoints use the same cells as a forward range.
      const indices=Array.from({length:Math.abs(end-start)+1},(_,i)=>Math.min(start,end)+i);
      const kept=indices.filter(i=>move(i,at,2,remove)!=null), expected=kept.reduce((sum,i)=>sum+100+i,0);
      expect(wb.validateValue(id,row?target:0,row?0:target,expected).ok,JSON.stringify({axis,remove,external,absStart,absEnd,at,p,start,end})).toBe(kept.length>0);
    }
  }
});
it('retains overlap precedence, IDs, and independent source-sheet edits',()=>{
  const {wb,id}=setup(); const other=wb.addSheet('Other');wb.setInput(other.id,0,0,'7');
  wb.addValidation(id,{id:'override',type:'formula',source:'A4=Other!$A$1',range:{r1:3,c1:0,r2:5,c2:0}});
  wb.insertRows(id,4,1);
  for(const r of [3,4,5,6])expect(wb.validateValue(id,r,0,7).ok).toBe(true);
  const ids=wb.sheet(id).validations.map(v=>v.id);expect(ids.length).toBeGreaterThan(1);expect(new Set(ids).size).toBe(ids.length);
  wb.insertRows(other.id,0,1);
  expect(wb.validateValue(id,5,0,7).ok).toBe(true);
});
it('turns fully deleted fixed list references into errors instead of replacement-cell sources',()=>{
  const wb=new Workbook({sheets:[{name:'Data',cells:{'1,1':{v:'Red'},'2,1':{v:'Blue'},'3,1':{v:'Wrong'}},validations:[{type:'list',source:'=B2:B3',range:{r1:0,c1:0,r2:0,c2:0}}]}]}),id=wb.activeSheetId;
  wb.deleteRows(id,1,2);
  expect(wb.listOptionsFor(id,wb.validationAt(id,0,0))).toEqual([]);
  expect(wb.validateValue(id,0,0,'Wrong').ok).toBe(false);
});
