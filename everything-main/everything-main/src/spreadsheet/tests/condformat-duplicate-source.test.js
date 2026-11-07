// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { openConditionalFormatting } from '../src/ui/condformat.js';
import { closeAllModals } from '../src/ui/modal.js';
vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));
beforeEach(() => { vi.stubGlobal('matchMedia', () => ({ matches: true })); document.body.innerHTML = '<div id="app"></div>'; });
afterEach(() => { closeAllModals(); vi.unstubAllGlobals(); document.body.replaceChildren(); });
const range = { r1:0,c1:0,r2:1,c2:0 };
function setup(rule={}) {
  const wb=new Workbook(), id=wb.activeSheetId;
  wb.setInput(id,0,0,'1');wb.setInput(id,1,0,'1');
  wb.addRule(id,{type:'dup',range,duplicateRange:'$A$1:$A$2',style:{bg:'#b6e6ad'},...rule});
  const {panel}=openConditionalFormatting({wb,sheetId:()=>id,range:()=>range,grid:{focus(){}}});
  panel.querySelector('.names-main').click();
  return {wb,id,panel,field:label=>panel.querySelector(`[aria-label="${label}"]`),submit:()=>panel.querySelector('form').requestSubmit()};
}
it('shows the native counting range and preserves an unchanged save',()=>{
  const {wb,field,submit}=setup();
  expect(field('Count values in').value).toBe('$A$1:$A$2');
  expect(field('Count values in').parentElement.hidden).toBe(false);
  const before=wb.toJSON(),version=wb.version;submit();
  expect(wb.toJSON()).toEqual(before);expect(wb.version).toBe(version);
});
it('edits the counting scope independently of the painted cells and supports undo',()=>{
  const {wb,id,field,submit}=setup();
  field('Count values in').value='$A$1';submit();
  expect(wb.activeSheet.rules[0].range).toEqual(range);
  expect(wb.activeSheet.rules[0].duplicateRange).toBe('$A$1');
  expect(wb.conditionalStyle(id,0,0,1)).toBeNull();
  wb.undo();expect(wb.conditionalStyle(id,0,0,1)).toEqual({bg:'#b6e6ad'});
});
it('rejects invalid or missing-sheet sources with a focused correction field',()=>{
  const {wb,field,submit}=setup(),before=wb.toJSON();
  for(const source of ['','SUM(A1:A2)',"Missing!A1:A2",'(A1:A2,#REF!)']){
    field('Count values in').value=source;submit();
    expect(wb.toJSON()).toEqual(before);expect(document.activeElement).toBe(field('Count values in'));
  }
  field('Count values in').value='(A1:A2,C1:C2)';submit();
  expect(wb.activeSheet.rules[0].duplicateRange).toBe('(A1:A2,C1:C2)');
});
it('keeps app-authored duplicate rules in their existing mode',()=>{
  const {wb,field,submit}=setup({duplicateRange:undefined});
  expect(field('Count values in').parentElement.hidden).toBe(true);
  const before=wb.toJSON();submit();expect(wb.toJSON()).toEqual(before);
});
