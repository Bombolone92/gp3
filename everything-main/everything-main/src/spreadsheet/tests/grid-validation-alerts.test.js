// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createGrid } from '../src/ui/grid.js';
import { Workbook } from '../src/core/workbook.js';
import { closeAllModals } from '../src/ui/modal.js';
import * as S from '../src/core/selection.js';
let grid;
beforeEach(()=>{
 vi.useFakeTimers();vi.stubGlobal('matchMedia',()=>({matches:true,addEventListener(){}}));
 vi.stubGlobal('requestAnimationFrame',fn=>setTimeout(fn,0));vi.stubGlobal('cancelAnimationFrame',clearTimeout);
 Object.defineProperty(HTMLElement.prototype,'clientWidth',{configurable:true,get:()=>800});Object.defineProperty(HTMLElement.prototype,'clientHeight',{configurable:true,get:()=>400});
 vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue({measureText:t=>({width:t.length*7}),font:''});
 Element.prototype.scrollTo=()=>{};document.body.innerHTML='<div id="app"></div>';
});
afterEach(()=>{grid?.destroy();grid=null;closeAllModals();vi.clearAllTimers();vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();document.body.replaceChildren()});
function setup(extra={}){
 const wb=new Workbook(),id=wb.activeSheetId;
 wb.setInput(id,0,0,'Good');wb.addValidation(id,{type:'list',source:['Good'],range:{r1:0,c1:0,r2:2,c2:0},strict:false,errorStyle:'warning',showErrorMessage:true,errorTitle:'Choose a category',message:'Pick from the list.',...extra});wb.clearHistory();
 grid=createGrid({wb,sheetId:id,validate:(r,c,t)=>{const v=wb.validateInput(id,r,c,t);return {...v,strict:v.rule?.strict!==false}}});document.querySelector('#app').append(grid.el);
 return {wb,id,enter:(text='Bad',opts={})=>{grid.beginEdit({text,mode:'type'});return grid.commitEdit(opts)}};
}
async function click(label){[...document.querySelectorAll('.modal-root:not(.closing) button')].find(b=>b.textContent===label).click();await Promise.resolve()}
it('defers invalid input, accepts once, moves once, and restores the previous value with Undo',async()=>{
 const {wb,id,enter}=setup();expect(enter('Bad',{move:'down'})).toBe(false);expect(wb.getValue(id,0,0)).toBe('Good');expect(grid.commitEdit()).toBe(false);expect(document.querySelectorAll('.modal-panel')).toHaveLength(1);
 expect(document.querySelector('.modal-panel').getAttribute('aria-label')).toBe('Choose a category');await click('Use value');expect(wb.getValue(id,0,0)).toBe('Bad');expect(grid.active.r).toBe(1);expect(grid.editing).toBe(false);wb.undo();expect(wb.getValue(id,0,0)).toBe('Good');
});
it('returns to the same entry for correction',async()=>{
 const {wb,id,enter}=setup();enter();await click('Edit value');expect(grid.editing).toBe(true);expect(grid.editState.text).toBe('Bad');expect(wb.getValue(id,0,0)).toBe('Good');grid.setEditText('Good');expect(grid.commitEdit()).toBe(true);
});
it.each(['Cancel','Escape'])('discards the draft on %s without changing history',async choice=>{
 const {wb,id,enter}=setup(),before=wb.toJSON();enter();if(choice==='Cancel')await click(choice);else{document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await Promise.resolve()}
 expect(grid.editing).toBe(false);expect(wb.getValue(id,0,0)).toBe('Good');expect(wb.toJSON()).toEqual(before);
});
it('offers only acceptance or cancellation for information alerts',async()=>{
 const {wb,id,enter}=setup({errorStyle:'information'});enter();expect(document.querySelector('.modal-panel').textContent).not.toContain('Edit value');await click('OK');expect(wb.getValue(id,0,0)).toBe('Bad');
});
it.each([{showErrorMessage:false},{errorStyle:undefined}])('retains silent non-strict behavior for %j',extra=>{
 const {wb,id,enter}=setup(extra);expect(enter()).toBe(true);expect(wb.getValue(id,0,0)).toBe('Bad');expect(document.querySelector('.modal-panel')).toBeNull();
});
it('does not let a stale alert overwrite a newer workbook change',async()=>{
 const {wb,id,enter}=setup();enter();wb.setInput(id,0,0,'Newer');await click('Use value');expect(wb.getValue(id,0,0)).toBe('Newer');expect(grid.editing).toBe(true);
});
it('does not commit after the entry or grid was discarded',async()=>{
 const {wb,id,enter}=setup();enter();grid.cancelEdit();await click('Use value');expect(wb.getValue(id,0,0)).toBe('Good');enter();grid.destroy();grid=null;await click('Use value');expect(wb.getValue(id,0,0)).toBe('Good');
});
it('preflights a strict destination before offering a multi-cell warning',async()=>{
 const {wb,id,enter}=setup();wb.addValidation(id,{type:'list',source:['Good'],strict:true,range:{r1:1,c1:0,r2:1,c2:0}});grid.setSelection(S.fromRange({r1:0,c1:0,r2:1,c2:0}));expect(enter('Bad',{fillSelection:true})).toBe(false);
 expect(document.querySelector('.modal-panel').textContent).toContain('Retry');expect(document.querySelector('.modal-panel').textContent).not.toContain('Use value');expect(wb.getValue(id,0,0)).toBe('Good');expect(wb.getValue(id,1,0)).toBeNull();
 await click('Retry');grid.setEditText('Good');expect(grid.commitEdit({fillSelection:true})).toBe(true);expect([0,1].map(r=>wb.getValue(id,r,0))).toEqual(['Good','Good']);wb.undo();expect(wb.getValue(id,1,0)).toBeNull();
});
it('defers a multi-cell entry until the warning is accepted',async()=>{
 const {wb,id,enter}=setup();grid.setSelection(S.fromRange({r1:0,c1:0,r2:2,c2:0}));enter('Bad',{fillSelection:true});expect(wb.getValue(id,2,0)).toBeNull();await click('Use value');expect([0,1,2].map(r=>wb.getValue(id,r,0))).toEqual(['Bad','Bad','Bad']);wb.undo();expect(wb.getValue(id,0,0)).toBe('Good');expect(wb.getValue(id,2,0)).toBeNull();
});
it('renders prompt titles and message bodies as text, including title-only messages',()=>{
 const {wb,id}=setup({promptTitle:'<b>Status</b>',prompt:'Choose <carefully>'});vi.advanceTimersByTime(1);
 const pop=document.querySelector('.prompt-pop');expect(pop.hidden).toBe(false);expect(pop.querySelector('strong').textContent).toBe('<b>Status</b>');expect(pop.querySelector('b')).toBeNull();expect(pop.querySelector('span').textContent).toBe('Choose <carefully>');
 wb.updateValidation(id,wb.activeSheet.validations[0].id,{prompt:undefined});grid.refresh();vi.advanceTimersByTime(1);expect(pop.hidden).toBe(false);expect(pop.querySelector('span')).toBeNull();
});
it('hides stored prompts when disabled and displays them again after Undo',()=>{
 const {wb,id}=setup({promptTitle:'Status',prompt:'Choose one'}),rule=wb.activeSheet.validations[0],pop=document.querySelector('.prompt-pop');vi.advanceTimersByTime(1);
 expect(pop.hidden).toBe(false);wb.updateValidation(id,rule.id,{showInputMessage:false});grid.refresh();vi.advanceTimersByTime(1);expect(pop.hidden).toBe(true);expect(wb.validationAt(id,0,0).prompt).toBe('Choose one');
 wb.undo();grid.refresh();vi.advanceTimersByTime(1);expect(pop.hidden).toBe(false);expect(pop.querySelector('strong').textContent).toBe('Status');
});
it('keeps legacy body-only prompts visible',()=>{
 setup({prompt:'Choose one'});vi.advanceTimersByTime(1);const pop=document.querySelector('.prompt-pop');expect(pop.hidden).toBe(false);expect(pop.textContent).toBe('Choose one');expect(pop.querySelector('strong')).toBeNull();
});

it.each([true,undefined])('rejects invalid entries with a Stop dialog when strict is %s',async strict=>{
 const {wb,id,enter}=setup({strict,errorStyle:'stop'}),before=wb.toJSON();
 expect(enter('Bad',{move:'down',acceptedWarnings:true})).toBe(false);expect(grid.commitEdit()).toBe(false);expect(document.querySelectorAll('.modal-panel')).toHaveLength(1);
 const panel=document.querySelector('.modal-panel');expect(panel.getAttribute('aria-label')).toBe('Choose a category');expect(panel.querySelector('.modal-text').textContent).toBe('Pick from the list.');expect(panel.getAttribute('aria-describedby')).toBe(panel.querySelector('.modal-text').id);
 expect([...panel.querySelectorAll('button')].map(b=>b.textContent)).toEqual(['','Cancel','Retry']);expect(document.activeElement.textContent).toBe('Retry');expect(wb.toJSON()).toEqual(before);expect(grid.active.r).toBe(0);
 grid.focus();grid.focusEditor();expect(document.activeElement.textContent).toBe('Retry');
 await click('Retry');expect(grid.editing).toBe(true);expect(grid.editState.text).toBe('Bad');expect(document.activeElement).toBe(grid.el.querySelector('.grid-editor'));
 grid.setEditText('Good');expect(grid.commitEdit({move:'down'})).toBe(true);expect(grid.active.r).toBe(1);expect(wb.getValue(id,0,0)).toBe('Good');
});
it.each(['Cancel','Escape','Close','scrim'])('discards a Stop draft on %s with no workbook or history changes',async choice=>{
 const {wb,id,enter}=setup({strict:true,errorStyle:'stop'}),before=wb.toJSON(),version=wb.version;enter('Bad',{move:'down'});
 if(choice==='Cancel')await click(choice);
 else if(choice==='Escape'){document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await Promise.resolve();}
 else{document.querySelector(choice==='Close'?'.modal-root:not(.closing) [aria-label="Close"]':'.modal-root:not(.closing) .modal-scrim').click();await Promise.resolve();}
 expect(grid.editing).toBe(false);expect(grid.active.r).toBe(0);expect(wb.getValue(id,0,0)).toBe('Good');expect(wb.toJSON()).toEqual(before);expect(wb.version).toBe(version);expect(wb.canUndo()).toBe(false);
});
it('keeps rejection and the editor when a strict alert is explicitly hidden',()=>{
 const {wb,id,enter}=setup({strict:true,errorStyle:'stop',showErrorMessage:false}),before=wb.toJSON();expect(enter()).toBe(false);expect(document.querySelector('.modal-panel')).toBeNull();expect(grid.editing).toBe(true);expect(wb.toJSON()).toEqual(before);expect(wb.getValue(id,0,0)).toBe('Good');
});
it.each(['Retry','Cancel'])('does not apply a stale Stop %s response after a workbook change',async choice=>{
 const {wb,id,enter}=setup({strict:true,errorStyle:'stop'});enter();wb.setInput(id,0,0,'Newer');await click(choice);expect(wb.getValue(id,0,0)).toBe('Newer');expect(grid.editing).toBe(true);expect(grid.editState.text).toBe('Bad');
});
it('does not apply a Stop response to a replacement draft or destroyed grid',async()=>{
 const {wb,id,enter}=setup({strict:true,errorStyle:'stop'});enter();grid.cancelEdit();grid.beginEdit({text:'Replacement'});await click('Cancel');expect(grid.editState.text).toBe('Replacement');expect(wb.getValue(id,0,0)).toBe('Good');
 grid.setEditText('Bad');grid.commitEdit();grid.destroy();grid=null;await click('Retry');expect(wb.getValue(id,0,0)).toBe('Good');
});
it('renders strict alert titles and messages as literal text',()=>{
 const {enter}=setup({strict:true,errorTitle:'<b>Check</b>',message:'<img src=x>Pick one'});enter();const panel=document.querySelector('.modal-panel');expect(panel.querySelector('h2').textContent).toBe('<b>Check</b>');expect(panel.querySelector('.modal-text').textContent).toBe('<img src=x>Pick one');expect(panel.querySelector('b,img')).toBeNull();
});
