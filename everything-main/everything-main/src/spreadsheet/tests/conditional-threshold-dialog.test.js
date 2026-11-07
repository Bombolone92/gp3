// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { openConditionalFormatting } from '../src/ui/condformat.js';
import { closeAllModals } from '../src/ui/modal.js';
import { cellsToHtml, parseHtmlClipboard } from '../src/core/clipboard.js';
vi.mock('../src/ui/toast.js',()=>({toast:vi.fn()}));
beforeEach(()=>{vi.stubGlobal('matchMedia',()=>({matches:true}));document.body.innerHTML='<div id="app"></div>';});
afterEach(()=>{closeAllModals();vi.unstubAllGlobals();document.body.replaceChildren();});
function open(type='scale'){
 const wb=new Workbook(),id=wb.activeSheetId,range={r1:0,c1:0,r2:2,c2:0};
 [1,5,10].forEach((v,r)=>wb.setInput(id,r,0,String(v)));
 wb.addRule(id,type==='scale'?{type,range,from:'#000000',to:'#ffffff',scaleMinType:'min',scaleMaxType:'percentile',scaleMax:'90',statisticsRange:'$A$1:$A$3'}
 :{type,range,barMode:'extended',barMinFormulaType:'autoMin',barMaxFormulaType:'autoMax',barColor:'#638ec6',statisticsRange:'$A$1:$A$3'});
 const {panel}=openConditionalFormatting({wb,sheetId:()=>id,range:()=>range,grid:{focus(){}}});panel.querySelector('.names-main').click();
 return {wb,id,panel,field:label=>panel.querySelector(`[aria-label="${label}"]`),submit:()=>panel.querySelector('form').requestSubmit()};
}
it('shows native threshold types, saves unchanged without an undo step, and edits percentages',()=>{
 const {wb,panel,field,submit}=open();
 expect(field('Low threshold type').value).toBe('min');expect(field('Low threshold').disabled).toBe(true);
 expect(field('High threshold type').value).toBe('percentile');expect(field('High threshold').value).toBe('90');
 const version=wb.version,before=wb.toJSON();submit();expect(wb.toJSON()).toEqual(before);expect(wb.version).toBe(version);
 panel.querySelector('.names-main').click();field('High threshold').value='120';submit();expect(wb.toJSON()).toEqual(before);expect(document.activeElement).toBe(field('High threshold'));
 field('High threshold type').value='percent';field('High threshold').value='75';submit();
 expect(wb.activeSheet.rules[0]).toMatchObject({scaleMinType:'min',scaleMaxType:'percent',scaleMax:'75'});
 wb.undo();expect(wb.toJSON()).toEqual(before);
});
it('switches native bounds to explicit formulas and back to automatic values',()=>{
 const {wb,panel,field,submit}=open();
 field('Low threshold type').value='';field('Low threshold type').dispatchEvent(new Event('change'));
 expect(field('Low threshold').disabled).toBe(false);field('Low threshold').value='=$E$1';submit();
 expect(wb.activeSheet.rules[0].scaleMinType).toBeUndefined();expect(wb.activeSheet.rules[0].scaleMin).toBe('$E$1');
 panel.querySelector('.names-main').click();field('Low threshold type').value='min';submit();
 expect(wb.activeSheet.rules[0].scaleMinType).toBe('min');expect(wb.activeSheet.rules[0].scaleMin).toBeUndefined();
});
it('keeps zero-inclusive bar types editable and cleans them when changing rule kinds',()=>{
 const {wb,panel,field,submit}=open('databar'),before=wb.toJSON();
 expect(field('Minimum bar value type').value).toBe('autoMin');submit();expect(wb.toJSON()).toEqual(before);
 panel.querySelector('.names-main').click();field('Minimum bar value type').value='num';field('Minimum bar value type').dispatchEvent(new Event('change'));field('Minimum bar value').value='-20';submit();
 expect(wb.activeSheet.rules[0]).toMatchObject({barMinFormulaType:'num',barMinFormula:'-20'});
 panel.querySelector('.names-main').click();field('Condition').value='gt';field('Condition').dispatchEvent(new Event('change'));field('Value').value='4';submit();
 expect(wb.activeSheet.rules[0].barMinFormulaType).toBeUndefined();
});
it('carries scalar native threshold types in app-to-app HTML and keeps them live on paste',()=>{
 const {wb,id}=open(),rows=[0,1],cols=[0],cells=wb.copyCells(id,rows,cols),conditionalFormats=wb.copyConditionalFormats(id,rows,cols);
 const html=cellsToHtml([['1'],['5']],cells,null,null,{r:0,c:0},{conditionalFormats});const copied=parseHtmlClipboard(html,'1\n5');
 wb.pasteCells(id,copied.cells,0,3,copied.origin,null,{conditionalFormats:copied.conditionalFormats});
 expect(wb.activeSheet.rules[0].scaleMinType).toBe('min');expect(wb.conditionalStyle(id,0,3,1)?.bg).toBe('#000000');
 wb.setInput(id,1,3,'9');expect(wb.conditionalStyle(id,1,3,9)?.bg).toBe('#ffffff');
});

it.each(['num','percent','percentile'])('edits and reopens a live %s threshold parameter without converting its type',type=>{
 const {wb,panel,field,submit}=open();
 field('High threshold type').value=type;field('High threshold').value='=SUM(40,40)';submit();
 expect(wb.activeSheet.rules[0]).toMatchObject({scaleMaxType:type,scaleMax:'SUM(40,40)'});
 panel.querySelector('.names-main').click();expect(field('High threshold').value).toBe('=SUM(40,40)');
 const before=wb.toJSON(),version=wb.version;submit();expect(wb.toJSON()).toEqual(before);expect(wb.version).toBe(version);
});
