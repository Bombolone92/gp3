import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
import {expectBodyEditParts} from './helpers/expect-body-edit-parts.js';

for(const fixture of ['print-border-phase','print-frame-grid','print-row-phase','print-row-pen-phase','print-coordinate-phase','print-coordinate-independent-phase','print-row-width-phase','print-paper-phase','print-high-row-phase','print-paper-height-phase','print-tie-phase','print-story-margin-phase'])test(`authored physical border cases remain editable through save, undo and reopen: ${fixture}`,async({page},info)=>{
 const pages={'print-row-phase':16,'print-row-pen-phase':80,'print-coordinate-phase':80,'print-coordinate-independent-phase':80,'print-row-width-phase':36,'print-paper-phase':8,'print-high-row-phase':8,'print-paper-height-phase':36,'print-tie-phase':8,'print-story-margin-phase':8}[fixture]||1;
 const source=`tests/fixtures/${fixture}/control.docx`;
 const original=unzipSync(readFileSync(source)),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});
 await expect(input).toBeEditable();await expect(input).toHaveValue(/^\s+$/);
 await expect(page.locator('canvas.canvas-page')).toHaveCount(pages);
 const text=await input.inputValue();
 const save=async name=>{
  const event=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();
  const path=info.outputPath(name+'.docx');await(await event).saveAs(path);return path;
 };
 expect(unzipSync(readFileSync(await save('noedit')))).toEqual(original);
 await input.press('ControlOrMeta+End');await input.press('X');await expect(input).toHaveValue(text+'X');
 const edited=await save('edited'),parts=unzipSync(readFileSync(edited));
 expectBodyEditParts(parts,original);
 await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(input).toHaveValue(text);
 expect(unzipSync(readFileSync(await save('undo')))).toEqual(original);
 await reopenDocx(page,input,edited,text+'X');
 await expect(page.locator('canvas.canvas-page')).toHaveCount(pages);
 expect(errors).toEqual([]);
});
