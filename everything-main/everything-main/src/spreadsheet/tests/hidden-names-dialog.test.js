// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {Workbook} from '../src/core/workbook.js';
import {openNamesManager} from '../src/ui/names.js';
import {closeAllModals} from '../src/ui/modal.js';
beforeEach(()=>vi.stubGlobal('matchMedia',()=>({matches:false,addEventListener(){},removeEventListener(){}})));
afterEach(()=>{closeAllModals();vi.unstubAllGlobals();document.body.replaceChildren();});
it('keeps hidden helper names out of the manager while protecting their namespace',()=>{
 const wb=new Workbook({names:[{name:'Private',ref:'1',hidden:true},{name:'Visible',ref:'2'}]});
 openNamesManager({wb,sheetId:()=>wb.activeSheetId,grid:{range:{r1:0,c1:0,r2:0,c2:0}},run:vi.fn()});
  document.querySelector('[aria-label="New name"]').click();
 expect(document.querySelector('.names-list').textContent).toContain('Visible');
 expect(document.querySelector('.names-list').textContent).not.toContain('Private');
 document.querySelector('[aria-label="Name"]').value='Private';
 document.querySelector('[aria-label="Refers to"]').value='9';
 document.querySelector('form.names-form').requestSubmit();
 expect(document.querySelector('.field-error').textContent).toContain('already used');
 expect(wb.namedEntry('Private').ref).toBe('1');
});
