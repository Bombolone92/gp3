import {expect,it} from 'vitest';
import {Workbook} from '../src/core/workbook.js';
import {conditionalRangesCoverSource} from '../src/core/conditional-groups.js';
import {workbookFromFile,workbookToXlsx} from '../src/core/io.js';
import * as X from '../src/vendor/xlsx.mjs';
const g=(r1,c1,r2=r1,c2=c1)=>({r1,c1,r2,c2});
function setup(rule={type:'scale',from:'#000000',to:'#ffffff'},totalsRow=false){
 const wb=new Workbook(),id=wb.activeSheetId;
 for(const[r,v]of[[0,'Amount'],[1,'0'],[2,'20']])wb.setInput(id,r,0,v);
 const tid=wb.addTable(id,g(0,0,2),{name:'Amounts'});
 if(totalsRow)wb.setTableTotals(id,tid,true);
 wb.addRule(id,{...rule,range:g(1,0,2),statisticsRange:'$A$2:$A$3'});
 return{wb,id,tid};
}
const look=(wb,r,c=0)=>wb.conditionalStyle(wb.activeSheetId,r,c,wb.getValue(wb.activeSheetId,r,c));
it.each(['typing','resize','new row','totals row'])('grows native color-scale statistics through %s, with Undo',mode=>{
 const {wb,id,tid}=setup(undefined,mode==='totals row');const before=wb.toJSON();wb.clearHistory();
 wb.transaction('Grow',()=>{
  if(mode==='resize')wb.resizeTable(id,tid,g(0,0,3));
  if(mode==='new row'||mode==='totals row')expect(wb.addTableRow(id,tid)).toBe(3);
  wb.setInput(id,3,0,'100');
 });
 expect(wb.activeSheet.rules[0].statisticsRange).toBe('$A$2:$A$4');expect(look(wb,2)).toEqual({bg:'#333333'});expect(look(wb,3)).toEqual({bg:'#ffffff'});
 wb.undo();expect(wb.toJSON()).toEqual(before);wb.redo();expect(look(wb,2)).toEqual({bg:'#333333'});
});
it.each(['scale','databar','icons','top','dup','unique'])('updates shared %s domains across adjacent pieces without changing IDs or priority',type=>{
 const {wb,id}=setup({type,from:'#000000',to:'#ffffff',style:{bold:true}}),first=wb.activeSheet.rules[0];
 first.statisticsRange='($A$2:$A$3,$D$2:$D$3)';if(type==='dup'||type==='unique')first.duplicateRange=first.statisticsRange;
 wb.addRule(id,{...first,range:g(1,3,2,3)});const ids=wb.activeSheet.rules.map(r=>r.id);
 wb.setInput(id,3,0,'100');expect(wb.activeSheet.rules.map(r=>r.id)).toEqual(ids);
 for(const rule of wb.activeSheet.rules){expect(rule.statisticsRange).toBe('($A$2:$A$4,$D$2:$D$3)');if(type==='dup'||type==='unique')expect(rule.duplicateRange).toBe(rule.statisticsRange);}
 expect(wb.activeSheet.rules[1].range).toEqual(g(1,3,2,3));
});
it('retains explicitly separate statistics and leaves unrelated priorities untouched',()=>{
 const{wb,id}=setup();const rule=wb.activeSheet.rules[0];rule.statisticsRange='$F$2:$F$3';wb.setInput(id,1,5,'0');wb.setInput(id,2,5,'10');
 wb.addRule(id,{type:'gt',range:g(1,5,2,5),value:5,style:{bold:true}});const outside=wb.activeSheet.rules[1];wb.setInput(id,3,0,'100');
 expect(wb.activeSheet.rules[0].statisticsRange).toBe('$F$2:$F$3');expect(look(wb,2)).toEqual({bg:'#ffffff'});expect(wb.activeSheet.rules[1]).toBe(outside);
});
it('retains the extended statistical domain in metadata-free XLSX',async()=>{
 const{wb,id}=setup();wb.setInput(id,3,0,'100');
 const zip=X.CFB.read(new Uint8Array(await(await workbookToXlsx(wb)).arrayBuffer()),{type:'array'}),part=X.CFB.find(zip,'/xl/workbook.xml');
 part.content=new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g,''));part.size=part.content.length;
 const back=await workbookFromFile(X.CFB.write(zip,{type:'array',fileType:'zip'}),'native.xlsx');expect(look(back,2)).toMatchObject({bg:'#333333'});expect(back.activeSheet.rules[0].range).toEqual(g(1,0,3));
});

it('recognizes equal coverage across partitions and rejects gaps and foreign sheets',()=>{
 expect(conditionalRangesCoverSource("'Sheet1'!$A$1:$A$4",[g(0,0,1),g(2,0,3)],'Sheet1')).toBe(true);
 expect(conditionalRangesCoverSource('$A$1:$A$4',[g(0,0,1),g(3,0)],'Sheet1')).toBe(false);
 expect(conditionalRangesCoverSource('Other!$A$1:$A$4',[g(0,0,3)],'Sheet1')).toBe(false);
 expect(conditionalRangesCoverSource('$A$1:$A$4',[g(0,0,4)],'Sheet1')).toBe(false);
});
it('grows legacy duplicate domains without inventing a separate statistical override',()=>{
 const {wb,id}=setup({type:'dup',duplicateRange:'$A$2:$A$3',style:{bold:true}});delete wb.activeSheet.rules[0].statisticsRange;
 wb.setInput(id,3,0,'20');expect(wb.activeSheet.rules[0].duplicateRange).toBe('$A$2:$A$4');expect(look(wb,2)).toEqual({bold:true});expect(wb.activeSheet.rules[0].statisticsRange).toBeUndefined();
});
