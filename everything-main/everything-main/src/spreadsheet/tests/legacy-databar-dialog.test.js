// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {Workbook} from '../src/core/workbook.js';
import {openConditionalFormatting} from '../src/ui/condformat.js';
import {closeAllModals} from '../src/ui/modal.js';
import {paintDataBar} from '../src/ui/data-bar.js';
beforeEach(()=>vi.stubGlobal('matchMedia',()=>({matches:false,addEventListener(){},removeEventListener(){}})));
afterEach(()=>{closeAllModals();vi.unstubAllGlobals();document.body.replaceChildren();});
function open(){
 const wb=new Workbook(),id=wb.activeSheetId,range={r1:1,c1:1,r2:3,c2:1};
 wb.addRule(id,{type:'databar',barMode:'legacy',barFullHeight:true,range,barMinFormula:'0',barMaxFormula:'100',barMinLength:10,barMaxLength:90,barColor:'#638ec6',style:{}});
 wb.markClean();wb.clearHistory();
 openConditionalFormatting({wb,sheetId:()=>id,range:()=>range,grid:{focus(){}}});
 document.querySelector('.names-main').click();
 return{wb,field:label=>document.querySelector(`[aria-label="${label}"]`),submit:()=>document.querySelector('form').requestSubmit()};
}
it('shows and preserves an untouched imported bar rule',()=>{
 const {wb,field,submit}=open(),before=JSON.stringify(wb.activeSheet.rules);
 expect(field('Minimum bar value').value).toBe('=0');expect(field('Maximum bar value').value).toBe('=100');
 expect(field('Shortest bar (%)').value).toBe('10');expect(field('Longest bar (%)').value).toBe('90');
 submit();expect(JSON.stringify(wb.activeSheet.rules)).toBe(before);expect(wb.canUndo()).toBe(false);
});
it('edits live thresholds and lengths, and clears formulas back to automatic bounds',()=>{
 const {wb,field,submit}=open();field('Minimum bar value').value='';field('Maximum bar value').value='=SUM(A1:A3)';
 field('Shortest bar (%)').value='25';field('Longest bar (%)').value='75';submit();
 expect(wb.activeSheet.rules[0]).toMatchObject({barMaxFormula:'SUM(A1:A3)',barMinLength:25,barMaxLength:75});
 expect(wb.activeSheet.rules[0].barMinFormula).toBeUndefined();
 wb.undo();expect(wb.activeSheet.rules[0].barMinFormula).toBe('0');
});
it('rejects reversed lengths without discarding the rule',()=>{
 const {wb,field,submit}=open();field('Shortest bar (%)').value='99';submit();
 expect(wb.canUndo()).toBe(false);expect(document.querySelector('.field-error').textContent).toContain('shortest');
});
it('clears native bar fields when changing the condition type',()=>{
 const {wb,field,submit}=open(),select=field('Condition');select.value='empty';select.dispatchEvent(new Event('change'));submit();
 expect(wb.activeSheet.rules[0].barMode).toBeUndefined();expect(wb.activeSheet.rules[0].barMaxFormula).toBeUndefined();
});
it('uses a gradient and native insets without altering ordinary app bars',()=>{
 const cell=document.createElement('div');
 paintDataBar(cell,{bar:.5,barColor:'#638ec6',barGradient:true,barFullHeight:true});
 expect(cell.style.backgroundImage).toContain('rgba(99, 142, 198, 0) 50%');
 expect(cell.style.backgroundSize).toBe('calc(100% - 4px) calc(100% - 4px)');
 expect(cell.style.backgroundPosition).toBe('2px 50%');
 paintDataBar(cell,{bar:.5,barColor:'#638ec6'});
 expect(cell.style.backgroundSize).toBe('100% 70%');expect(cell.style.backgroundPosition).toBe('0px 50%');
});

it('prints the same gradient, inset, and value visibility as the grid',async()=>{
 const {buildPrintTable}=await import('../src/ui/print.js');
 const wb=new Workbook(),id=wb.activeSheetId;
 wb.setInput(id,0,0,'20');
 wb.addRule(id,{type:'databar',barMode:'legacy',range:{r1:0,c1:0,r2:0,c2:0},barMinFormula:'0',barMaxFormula:'40',barOnly:true,barColor:'#638ec6'});
 const td=buildPrintTable(wb,id).querySelector('tbody td'),grid=document.createElement('div');
 paintDataBar(grid,wb.conditionalStyle(id,0,0,20));
 expect(td.style.backgroundImage).toBe(grid.style.backgroundImage);expect(td.style.backgroundSize).toBe(grid.style.backgroundSize);
 expect(td.style.backgroundPosition).toBe(grid.style.backgroundPosition);expect(td.textContent).toBe('');
});
it('exposes and edits activation while preserving legacy bar geometry and undo',()=>{
 const {wb,field,submit}=open(),before=wb.toJSON();
 expect(field('Show bars when').closest('div').hidden).toBe(false);field('Show bars when').value='=A2>0';submit();
 expect(wb.activeSheet.rules[0]).toMatchObject({barMode:'legacy',barActiveFormula:'A2>0',barMinLength:10,barMaxLength:90});
 wb.undo();expect(wb.toJSON()).toEqual(before);
});
