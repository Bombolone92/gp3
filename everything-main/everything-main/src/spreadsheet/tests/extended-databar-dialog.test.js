// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {Workbook} from '../src/core/workbook.js';
import {openConditionalFormatting} from '../src/ui/condformat.js';
import {closeAllModals} from '../src/ui/modal.js';
import {paintDataBar} from '../src/ui/data-bar.js';
import {buildPrintTable} from '../src/ui/print.js';
import {cellsToHtml,parseHtmlClipboard,cellsFromHtmlRows} from '../src/core/clipboard.js';
beforeEach(()=>vi.stubGlobal('matchMedia',()=>({matches:false,addEventListener(){},removeEventListener(){}})));
afterEach(()=>{closeAllModals();vi.unstubAllGlobals();document.body.replaceChildren();});
function open(extra={}){
 const wb=new Workbook(),id=wb.activeSheetId,range={r1:0,c1:0,r2:0,c2:0};
 wb.setInput(id,0,0,'-10');
 wb.addRule(id,{type:'databar',barMode:'extended',range,barMinFormula:'-20',barMaxFormula:'40',barMinLength:0,barMaxLength:100,barColor:'#638ec6',style:{},...extra});
 wb.markClean();wb.clearHistory();
 openConditionalFormatting({wb,sheetId:()=>id,range:()=>range,grid:{focus(){}}});
 document.querySelector('.names-main').click();
 return{wb,id,field:label=>document.querySelector(`[aria-label="${label}"]`),submit:()=>document.querySelector('form').requestSubmit()};
}
it('shows native options without changing an untouched minimal rule',()=>{
 const {wb,field,submit}=open(),before=JSON.stringify(wb.activeSheet.rules);
 expect(field('Zero axis').value).toBe('automatic');expect(field('Bar direction').value).toBe('context');
 expect(field('Bar border color').value).toBe('#638ec6');expect(field('Gradient fill').checked).toBe(true);
 expect(field('Minimum bar value').closest('div').hidden).toBe(false);
 submit();expect(JSON.stringify(wb.activeSheet.rules)).toBe(before);expect(wb.canUndo()).toBe(false);
});
it('edits every extended appearance option and restores it with undo',()=>{
 const {wb,field,submit}=open();field('Zero axis').value='middle';field('Bar direction').value='rightToLeft';
 field('Gradient fill').checked=false;field('Bar border').checked=true;
 field('Bar border color').value='#112233';field('Negative bar color').value='#445566';field('Zero axis color').value='#778899';
 field('Use positive border color for negative values').checked=false;field('Negative border color').value='#aabbcc';
 field('Maximum bar value').value='100';submit();
 expect(wb.activeSheet.rules[0]).toMatchObject({barAxisPosition:'middle',barDirection:'rightToLeft',barGradient:false,barBorder:true,barBorderColor:'#112233',barNegativeColor:'#445566',barNegativeBorderColorSame:false,barNegativeBorderColor:'#aabbcc',barAxisColor:'#778899',barMaxFormula:'100'});
 wb.undo();expect(wb.activeSheet.rules[0].barMaxFormula).toBe('40');expect(wb.activeSheet.rules[0].barDirection).toBeUndefined();
});
it('removes all native options when changing the condition type',()=>{
 const {wb,field,submit}=open({barDirection:'rightToLeft',barBorder:true,barNegativeColor:'#cc0000'});
 field('Condition').value='empty';field('Condition').dispatchEvent(new Event('change'));submit();
 for(const key of ['barMode','barMinFormula','barMaxLength','barDirection','barBorder','barNegativeColor'])expect(wb.activeSheet.rules[0][key]).toBeUndefined();
});
it('uses the same responsive SVG in grid and print with independent border, fill and dashed axis',()=>{
 const {wb,id}=open({barBorder:true,barOnly:true,barGradient:false,barNegativeColor:'#cc0000',barNegativeBorderColorSame:false,barNegativeBorderColor:'#880088',barAxisColor:'#00aa00'});
 const cell=document.createElement('div');paintDataBar(cell,wb.conditionalStyle(id,0,0,-10));
 const svg=decodeURIComponent(cell.style.backgroundImage);
 expect(svg).toContain('fill="#cc0000"');expect(svg).toContain('stroke="#880088" stroke-width="2"');
 expect(svg).toContain('stroke="#00aa00" stroke-dasharray="1 1"');expect(svg).not.toContain('viewBox');
 const td=buildPrintTable(wb,id).querySelector('tbody td');
 expect(td.style.backgroundImage).toBe(cell.style.backgroundImage);expect(td.style.backgroundSize).toBe(cell.style.backgroundSize);expect(td.textContent).toBe('');
});
it('paints a zero axis even when the zero value has no bar',()=>{
 const {wb,id}=open({barMinFormula:'0',barMaxFormula:'0'});wb.setInput(id,0,0,'0');
 const cell=document.createElement('div');paintDataBar(cell,wb.conditionalStyle(id,0,0,0));
 const svg=decodeURIComponent(cell.style.backgroundImage);expect(svg).toContain('<line x1="50%"');expect(svg).not.toContain('<rect');
});

it('preserves typed numeric values in internal and external HTML clipboard paths',()=>{
 const {wb,id}=open({barOnly:true});
 const cells=wb.copyRange(id,{r1:0,c1:0,r2:0,c2:0});
 wb.pasteCells(id,cells,1,1);expect(wb.getValue(id,1,1)).toBe(-10);
 const html=cellsToHtml([['']],cells,[[wb.conditionalStyle(id,0,0,-10)]],[[-10]]);
 for(const source of [html,html.replace(/ data-spreadsheet-[\w-]+="[^"]*"/g,'')]){
  const parsed=parseHtmlClipboard(source);
  expect((parsed.cells || [cellsFromHtmlRows(parsed.rows).map(entry=>entry.cell)])[0][0].v).toBe(-10);
 }
 // HTML has no portable data-bar rule representation. Values survive; live
 // rules travel through XLSX and whole-sheet copies, not this clipboard path.
});
it('edits activation separately from fixed bounds, preserves no-op saves and validates atomically',()=>{
 const {wb,id,field,submit}=open({barActiveFormula:'B1'}),before=wb.toJSON();
 expect(field('Show bars when').value).toBe('=B1');submit();expect(wb.toJSON()).toEqual(before);expect(wb.canUndo()).toBe(false);
 document.querySelector('.names-main').click();
 for(const value of ['bad','=NO_SUCH_FUNCTION(']){field('Show bars when').value=value;submit();expect(wb.toJSON()).toEqual(before);expect(document.activeElement).toBe(field('Show bars when'));}
 field('Show bars when').value='=$B$1>0';submit();expect(wb.activeSheet.rules[0].barActiveFormula).toBe('$B$1>0');
 expect(wb.activeSheet.rules[0].barMinFormula).toBe('-20');wb.undo();expect(wb.toJSON()).toEqual(before);
 document.querySelector('.names-main').click();field('Show bars when').value='';submit();expect(wb.activeSheet.rules[0].barActiveFormula).toBeUndefined();
 wb.undo();document.querySelector('.names-main').click();field('Condition').value='empty';field('Condition').dispatchEvent(new Event('change'));submit();expect(wb.activeSheet.rules[0].barActiveFormula).toBeUndefined();
});
it('prints an inactive bar-only rule with its value and retains live activation in HTML copies',()=>{
 const {wb,id}=open({barActiveFormula:'B1',barOnly:true}),g={r1:0,c1:0,r2:0,c2:0};
 let td=buildPrintTable(wb,id).querySelector('tbody td');expect(td.textContent.trim()).toBe('-10');expect(td.style.backgroundImage).toBe('');
 wb.setInput(id,0,1,'1');td=buildPrintTable(wb,id).querySelector('tbody td');expect(td.textContent).toBe('');expect(td.style.backgroundImage).toContain('svg');
 const rows=[0],cols=[0,1],cells=wb.copyCells(id,rows,cols),conditionalFormats=wb.copyConditionalFormats(id,rows,cols);
 const parsed=parseHtmlClipboard(cellsToHtml([['-10','1']],cells,null,null,{r:0,c:0},{conditionalFormats})),other=new Workbook();
 other.pasteCells(other.activeSheetId,parsed.cells,2,3,parsed.origin,null,{conditionalFormats:parsed.conditionalFormats});
 expect(other.activeSheet.rules[0].barActiveFormula).toBe('E3');expect(other.conditionalStyle(other.activeSheetId,2,3,-10)?.bar).toBeDefined();
 other.setInput(other.activeSheetId,2,4,'0');expect(other.conditionalStyle(other.activeSheetId,2,3,-10)).toBeNull();
});
