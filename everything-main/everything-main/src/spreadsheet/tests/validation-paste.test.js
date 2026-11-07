// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { cellsToHtml, parseHtmlClipboard } from '../src/core/clipboard.js';
const g = (r1,c1,r2=r1,c2=c1) => ({r1,c1,r2,c2});
const at = (wb,r,c) => wb.validationAt(wb.activeSheetId,r,c);
it('carries alert styles, enabled state and titles through HTML clipboard records',()=>{
 const wb=new Workbook(),id=wb.activeSheetId;
 wb.setInput(id,0,0,'Yes');wb.addValidation(id,{range:g(0,0),type:'list',source:['Yes','No'],strict:false,errorStyle:'information',showErrorMessage:true,errorTitle:'Pick one',message:'Use the list'});
 const cells=wb.copyCells(id,[0],[0]),validations=wb.copyValidations(id,[0],[0]);
 const html=cellsToHtml([['Yes']],cells,null,null,{r:0,c:0},{validations});
 const parsed=parseHtmlClipboard(html,'Yes'),other=new Workbook();
 other.pasteCells(other.activeSheetId,parsed.cells,2,3,parsed.origin,null,{validations:parsed.validations});
 expect(at(other,2,3)).toMatchObject({errorStyle:'information',showErrorMessage:true,errorTitle:'Pick one',message:'Use the list'});
});
function copy(wb, rows=[1,2,3], cols=[0]) {
  return {cells:wb.copyCells(wb.activeSheetId,rows,cols),validations:wb.copyValidations(wb.activeSheetId,rows,cols)};
}
function paste(wb, data,r=5,c=2,options={},target=null) {
  return wb.pasteCells(wb.activeSheetId,data.cells,r,c,null,target,{validations:data.validations,...options});
}
function setup() {
  const wb=new Workbook(),id=wb.activeSheetId;
  [1,2,3,4,5].forEach((n,r)=>wb.setInput(id,r,0,String(n)));
  wb.addValidation(id,{type:'formula',source:'AND(A1>$F$1,$A1<G$2)',range:g(0,0,4,0),strict:true,prompt:'Check'});
  wb.addValidation(id,{type:'formula',source:'C1<99',range:g(0,2,10,2)});
  return wb;
}
it('replaces destination validation, rebases split pieces, and undoes cells and rules together',()=>{
  const wb=setup(),before=wb.toJSON();paste(wb,copy(wb));
  expect(at(wb,5,2)).toMatchObject({source:'AND(C6>$F$1,$A6<I$2)',range:g(5,2,7,2),strict:true,prompt:'Check'});
  expect(at(wb,8,2).source).toBe('C9<99');expect(at(wb,4,2).source).toBe('C1<99');
  expect(wb.getValue(wb.activeSheetId,5,2)).toBe(2);
  wb.undo();expect(wb.toJSON()).toEqual(before);wb.redo();expect(at(wb,5,2).prompt).toBe('Check');
});
it('keeps snapshots independent and fixed list sources fixed',()=>{
 const wb=setup(),id=wb.activeSheetId;
 wb.addValidation(id,{type:'list',source:['Red','Blue'],colors:{Red:'#ff0000'},range:g(1,0,3,0)});
 const data=copy(wb);paste(wb,data);at(wb,5,2).source.push('Green');at(wb,5,2).colors.Red='#000000';
 expect(data.validations.at(-1).rule.source).toEqual(['Red','Blue']);expect(data.validations.at(-1).rule.colors.Red).toBe('#ff0000');
 wb.addValidation(id,{type:'list',source:'A1:A3',range:g(1,0,3,0)});paste(wb,copy(wb));expect(at(wb,5,2).source).toBe('A1:A3');
 wb.updateValidation(id,at(wb,1,0).id,{relativeSource:true});paste(wb,copy(wb));expect(at(wb,5,2).source).toBe('C5:C7');
});
it('compacts filtered rows, transposes ranges, and tiles without expanding uniform rules per cell',()=>{
 const wb=setup();paste(wb,copy(wb,[0,2,4]),5,4,{transpose:true});
 expect(at(wb,5,6)).toMatchObject({range:g(5,4,5,6),source:'AND(E6>$F$1,$A6<K$2)'});
 paste(wb,copy(wb,[0]),20,4,{},g(20,4,19999,4));
 expect(at(wb,19999,4).range).toEqual(g(20,4,19999,4));expect(wb.activeSheet.validations.length).toBeLessThan(10);
});
it('empty snapshots clear validation; absent metadata and formulas-only preserve it',()=>{
 const wb=setup(),blank=copy(wb,[0],[8]);paste(wb,blank,5,2,{keepStyles:true});expect(at(wb,5,2)).not.toBeNull();
 paste(wb,{...blank,validations:undefined});expect(at(wb,5,2)).not.toBeNull();
 paste(wb,blank);expect(at(wb,5,2)).toBeNull();expect(at(wb,6,2)).not.toBeNull();
});
it('skip-blanks replaces only written cells and protected pastes remain atomic',()=>{
 const wb=setup(),data=copy(wb);data.cells[1][0]=null;paste(wb,data,5,2,{skipBlanks:true});
 expect(at(wb,5,2).prompt).toBe('Check');expect(at(wb,6,2).source).toBe('C7<99');
 wb.activeSheet.protectedRanges.push({id:'lock',range:g(6,2)});const before=wb.toJSON();
 expect(paste(wb,data,5,2,{checkOnly:true})).toBe(false);paste(wb,data);expect(wb.toJSON()).toEqual(before);
});
it('carries cross-tab HTML validation snapshots and ignores malformed or edited snapshots',()=>{
 const wb=setup(),data=copy(wb),texts=[['2'],['3'],['4']];
 const html=cellsToHtml(texts,data.cells,null,null,null,{validations:data.validations});
 const parsed=parseHtmlClipboard(html,'2\n3\n4'),other=new Workbook();paste(other,parsed);expect(at(other,5,2).prompt).toBe('Check');
 expect(parseHtmlClipboard(html.replace('>2<','>20<'),'20\n3\n4').validations).toBeUndefined();
 for(const rule of [{...data.validations[0].rule,source:42},{...data.validations[0].rule,type:'bad'}]) {
  const doc=new DOMParser().parseFromString(html,'text/html');doc.querySelector('table').setAttribute('data-spreadsheet-validations',JSON.stringify([{...data.validations[0],rule}]));
  expect(parseHtmlClipboard(doc.body.innerHTML,'2\n3\n4').validations).toBeUndefined();
 }
});
it('retains last-rule priority and commits merged pastes with one Undo',()=>{
 const wb=setup(),id=wb.activeSheetId;
 wb.addValidation(id,{type:'list',source:['Yes','No'],range:g(2,0),prompt:'Choose'});
 const data=copy(wb);paste(wb,data,5,4);expect(at(wb,6,4).prompt).toBe('Choose');expect(at(wb,5,4).prompt).toBe('Check');
 const before=wb.toJSON();wb.clearHistory();
 paste(wb,copy(wb,[0,1],[0]),10,6,{merges:[g(0,0,1,0)]});
 expect(wb.activeSheet.merges).toContainEqual(g(10,6,11,6));expect(at(wb,10,6).prompt).toBe('Check');expect(wb.undoLabels()).toEqual(['Paste']);wb.undo();expect(wb.toJSON()).toEqual(before);
});
