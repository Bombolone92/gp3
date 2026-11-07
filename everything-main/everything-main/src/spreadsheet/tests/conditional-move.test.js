import {expect,it} from 'vitest';
import {Workbook} from '../src/core/workbook.js';
import {workbookFromFile,workbookToXlsx} from '../src/core/io.js';
import {conditionalMoveBlocks} from '../src/core/conditional-move.js';
import * as X from '../src/vendor/xlsx.mjs';
const g=(r1,c1,r2=r1,c2=c1)=>({r1,c1,r2,c2});
const look=(wb,r,c=0,id=wb.activeSheetId)=>wb.conditionalStyle(id,r,c,wb.getValue(id,r,c));
function setup(){const wb=new Workbook(),id=wb.activeSheetId;[0,25,50,75,100].forEach((v,r)=>wb.setInput(id,r+1,0,String(v)));return wb;}
function move(wb,src,r,c,method='drag',id=wb.activeSheetId){return method==='drag'?wb.moveRange(wb.activeSheetId,src,r,c):wb.placeMoved(id,r,c,wb.copyRange(wb.activeSheetId,src),{sheetId:wb.activeSheetId,range:src});}
it.each(['drag','cut'])('moves a partial predicate and clears only its old paint area (%s)',method=>{
 const wb=setup(),id=wb.activeSheetId;wb.addRule(id,{type:'formula',range:g(1,0,5),value:'A2>25',style:{bg:'#ffc000'}});
 const before=wb.toJSON();move(wb,g(2,0,4),2,3,method);
 expect([2,3,4].map(r=>look(wb,r,3)?.bg)).toEqual([undefined,'#ffc000','#ffc000']);
 expect(look(wb,5)?.bg).toBe('#ffc000');wb.setInput(id,3,0,'80');expect(look(wb,3)).toBeNull();
 wb.undo();wb.undo();expect(wb.toJSON()).toEqual(before);wb.redo();expect(look(wb,3,3)?.bg).toBe('#ffc000');
});
it('rewrites relative dependent predicates only where their references follow the cut',()=>{
 const wb=setup(),id=wb.activeSheetId;wb.addRule(id,{type:'formula',range:g(1,4,5,4),value:'$A2>25',style:{bold:true}});
 move(wb,g(2,0,4),8,2);
 expect(look(wb,3,4)).toEqual({bold:true});wb.setInput(id,9,2,'0');expect(look(wb,3,4)).toBeNull();expect(look(wb,5,4)).toEqual({bold:true});
 expect(wb.activeSheet.rules.find(x=>x.range.r1===2).value).toBe('$C9>25');
});
it('handles mixed and absolute endpoints without moving spanning references',()=>{
 const wb=setup(),id=wb.activeSheetId;
 wb.setInput(id,0,5,'1');wb.addRule(id,{type:'formula',range:g(1,3,5,4),value:'AND($A2>25,$F$1=1,SUM(A2:A4)>0)',style:{bold:true}});
 move(wb,g(2,0,4),2,6);
 const middle=wb.activeSheet.rules.find(x=>x.range.r1===2&&x.range.c1===3);
 expect(middle.value).toContain('$G3>25');expect(middle.value).toContain('$F$1=1');expect(middle.value).toContain('SUM(G3:G5)');
 expect(wb.activeSheet.rules.find(x=>x.range.r1===1&&x.range.c1===3).value).toContain('SUM(A2:A4)');
});
it.each(['scale','databar','icons','dup','top'])('preserves the complete statistical domain after a same-sheet %s cut',type=>{
 const wb=setup(),id=wb.activeSheetId;wb.addRule(id,{type,range:g(1,0,5),from:'#000000',to:'#ffffff',value:1,style:{bold:true}});
 const before=[2,3,4].map(r=>look(wb,r));move(wb,g(2,0,4),2,3);
 expect([2,3,4].map(r=>look(wb,r,3))).toEqual(before);
 expect(new Set(wb.activeSheet.rules.map(x=>x.statisticsRange)).size).toBe(1);
 if(type==='scale'){wb.setInput(id,5,0,'200');expect(look(wb,3,3)?.bg).toBe('#3f3f3f');}
});
it('shares native duplicate counts across surviving and moved pieces',()=>{
 const wb=setup(),id=wb.activeSheetId;wb.setInput(id,1,0,'50');
 wb.addRule(id,{type:'dup',range:g(1,0,5),duplicateRange:'$A$2:$A$6',style:{bold:true}});
 move(wb,g(2,0,4),2,3);expect(look(wb,3,3)).toEqual({bold:true});expect(look(wb,1)).toEqual({bold:true});
 wb.setInput(id,1,0,'1');expect(look(wb,3,3)).toBeNull();
});
it('subtracts overwritten destination cells without changing remaining priority',()=>{
 const wb=setup(),id=wb.activeSheetId;wb.addRule(id,{type:'formula',range:g(1,0,5),value:'TRUE',style:{bg:'#ff0000'},stopIfTrue:false});
 wb.addRule(id,{type:'formula',range:g(0,2,7,2),value:'TRUE',style:{bold:true}});
 move(wb,g(2,0,4),2,2);expect(look(wb,3,2)).toEqual({bg:'#ff0000'});expect(look(wb,1,2)).toEqual({bold:true});
 move(wb,g(10,5),3,2);expect(look(wb,3,2)).toBeNull();expect(look(wb,2,2)).toEqual({bg:'#ff0000'});
});
it('moves overlapping ranges once and preserves the shared scale',()=>{
 const wb=setup(),id=wb.activeSheetId;wb.addRule(id,{type:'scale',range:g(1,0,5),from:'#000000',to:'#ffffff'});
 move(wb,g(1,0,4),2,0);expect([2,3,4,5].map(r=>wb.getValue(id,r,0))).toEqual([0,25,50,75]);
 expect([2,3,4,5].map(r=>look(wb,r)?.bg)).toEqual(['#000000','#555555','#aaaaaa','#ffffff']);
 wb.setInput(id,1,0,'150');expect(look(wb,1)).toBeNull();
});
it('splits statistical domains on a cross-sheet cut',()=>{
 const wb=setup(),id=wb.activeSheetId,other=wb.addSheet('Other').id;wb.activeSheetId=id;
 wb.addRule(id,{type:'scale',range:g(1,0,5),from:'#000000',to:'#ffffff',scaleMinType:'min',scaleMaxType:'max',statisticsRange:'$A$2:$A$6'});
 move(wb,g(2,0,4),2,2,'cut',other);
 expect([2,3,4].map(r=>look(wb,r,2,other)?.bg)).toEqual(['#000000','#7f7f7f','#ffffff']);
 wb.setInput(id,5,0,'200');expect(look(wb,4,2,other)?.bg).toBe('#ffffff');
});
it('keeps moved self references and outside local references distinct across sheets',()=>{
 const wb=setup(),id=wb.activeSheetId,other=wb.addSheet('Other').id;wb.activeSheetId=id;
 wb.addRule(id,{type:'formula',range:g(1,0,5),value:'AND(A2>25,$F2=1)',style:{bold:true}});
 wb.setInput(other,3,5,'1');move(wb,g(2,0,4),2,2,'cut',other);
 expect(look(wb,3,2,other)).toEqual({bold:true});expect(wb.sheet(other).rules[0].value).toBe('AND(C3>25,$F3=1)');
});
it('rewrites dependent rules on protected sheets without editing their paint ranges',()=>{
 const wb=setup(),id=wb.activeSheetId,other=wb.addSheet('Other').id;wb.activeSheetId=id;
 wb.addRule(other,{type:'formula',range:g(1,2,5,2),value:'Sheet1!A2>25',style:{bold:true}});
 wb.setSheetProtected(other,true);move(wb,g(2,0,4),8,4);
 expect(look(wb,3,2,other)).toEqual({bold:true});expect(wb.sheet(other).rules.find(x=>x.range.r1===2).value).toBe('Sheet1!E9>25');
});
it('leaves rules and history unchanged when the destination refuses the move',()=>{
 const wb=setup(),id=wb.activeSheetId;wb.addRule(id,{type:'formula',range:g(1,0,5),value:'TRUE',style:{bold:true}});
 wb.activeSheet.protectedRanges.push({id:'lock',range:g(2,3)});const before=wb.toJSON(),version=wb.version;
 expect(move(wb,g(2,0,4),2,3,'cut')).toBeNull();expect(wb.toJSON()).toEqual(before);expect(wb.version).toBe(version);
});
it('moves packed visible rows without leaving rules on the cleared source cells',()=>{
 const wb=setup(),id=wb.activeSheetId;wb.addRule(id,{type:'scale',range:g(1,0,5),from:'#000000',to:'#ffffff'});
 const rows=[1,3,5],cols=[0],cells=wb.copyCells(id,rows,cols),before=wb.toJSON();
 wb.transaction('Move cells',()=>{wb.moveConditionalFormatsFromCells(id,id,rows,cols,8,2);wb.setCells(id,rows.map(r=>({r,c:0,cell:null})));wb.pasteCells(id,cells,8,2,{r:1,c:0,rows,cols});});
 expect([8,9,10].map(r=>look(wb,r,2)?.bg)).toEqual(['#000000','#7f7f7f','#ffffff']);expect(look(wb,2)?.bg).toBe('#3f3f3f');
 wb.setInput(id,3,0,'99');expect(look(wb,3)).toBeNull();wb.undo();wb.undo();expect(wb.toJSON()).toEqual(before);
 expect(conditionalMoveBlocks([1,2,5],[0,1,4],8,2)).toHaveLength(4);
});
it('preserves band phase without introducing a header when an interior block moves upwards',()=>{
 const wb=setup(),id=wb.activeSheetId;wb.addRule(id,{type:'bands',range:g(1,0,5),headerColor:'#111111',color1:'#222222',color2:'#333333'});
 const before=[3,4].map(r=>look(wb,r));move(wb,g(3,0,4),0,3);
 expect([0,1].map(r=>look(wb,r,3))).toEqual(before);expect(look(wb,1)).toMatchObject({bg:'#111111',bold:true});
});
it('reopens moved rules as native XLSX without private metadata',async()=>{
 const wb=setup(),id=wb.activeSheetId;wb.addRule(id,{type:'scale',range:g(1,0,5),from:'#000000',to:'#ffffff',scaleMinType:'min',scaleMaxType:'max',statisticsRange:'$A$2:$A$6'});
 move(wb,g(2,0,4),2,3);
 const zip=X.CFB.read(new Uint8Array(await(await workbookToXlsx(wb)).arrayBuffer()),{type:'array'}),book=X.CFB.find(zip,'/xl/workbook.xml');
 book.content=new TextEncoder().encode(new TextDecoder().decode(book.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g,''));book.size=book.content.length;
 const reopened=await workbookFromFile(X.CFB.write(zip,{type:'array',fileType:'zip'}),'move.xlsx');
 expect([2,3,4].map(r=>look(reopened,r,3)?.bg)).toEqual(['#3f3f3f','#7f7f7f','#bfbfbf']);
 reopened.setInput(reopened.activeSheetId,5,0,'200');expect(look(reopened,3,3)?.bg).toBe('#3f3f3f');
});
