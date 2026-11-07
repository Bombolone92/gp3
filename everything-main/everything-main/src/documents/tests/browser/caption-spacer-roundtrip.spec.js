import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';

test.setTimeout(180000);
test('caption spacer control edits, exports, undoes and reopens without losing border declarations',async({page},info)=>{
 const source='tests/fixtures/caption-spacer-flow/control.docx',parts=unzipSync(readFileSync(source));
 await page.goto('/playground.html');const previous=await page.getByRole('textbox',{name:'Document text'}).elementHandle();
 await page.getByLabel('Open DOCX file').setInputFiles(source);
 await expect.poll(()=>previous.evaluate(e=>e.isConnected),{timeout:90000}).toBe(false);
 const input=page.getByRole('textbox',{name:'Document text'});
 await expect(input).toBeEditable();await expect(page.locator('canvas.canvas-page')).toHaveCount(6);
 const original=await input.inputValue();
 const save=async name=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await pending).saveAs(path);return path;};
 expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
 await input.evaluate(el=>{const at=el.value.indexOf('Caption')+7;el.focus();el.setSelectionRange(at,at);el.dispatchEvent(new Event('select'));});
 await page.keyboard.insertText(' Edited');const changed=original.replace('Caption','Caption Edited');
 await expect(input).toHaveValue(changed);const edited=await save('edited');
 const editedParts=unzipSync(readFileSync(edited));expect(Object.keys(editedParts).sort()).toEqual(Object.keys(parts).sort());
 for(const name of Object.keys(parts))if(name!=='word/document.xml')expect(editedParts[name]).toEqual(parts[name]);
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);
 expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);
 await reopenDocx(page,input,edited,changed);await expect(page.locator('canvas.canvas-page')).toHaveCount(6);
 await expect(page.locator('#playground-error')).toBeEmpty();
});
