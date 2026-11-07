import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';

test('a DOCX beyond 100,000 characters renders editable, saves, reopens and undoes',async({page},info)=>{
 test.setTimeout(240000);
 const source='tests/fixtures/large-text/control.docx',errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/playground.html');
 const input=page.getByRole('textbox',{name:'Document text',exact:true}),prior=await input.elementHandle();
 await page.getByLabel('Open DOCX file').setInputFiles(source);
 await expect.poll(()=>prior.evaluate(e=>e.isConnected),{timeout:120000}).toBe(false);
 await expect(input).toHaveJSProperty('readOnly',false);
 const text=await input.inputValue();expect(text.length).toBe(120119);
 expect(await page.locator('canvas.canvas-page').count()).toBeGreaterThan(1);
 const download=async name=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name);await(await pending).saveAs(path);return path;};
 expect(unzipSync(readFileSync(await download('noedit.docx')))).toEqual(unzipSync(readFileSync(source)));
 await input.focus();await input.press('ControlOrMeta+End');await page.keyboard.insertText(' Large edit.');
 await expect(input).toHaveValue(text+' Large edit.');
 const edited=await download('edited.docx');
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(text);
 expect(unzipSync(readFileSync(await download('undo.docx')))).toEqual(unzipSync(readFileSync(source)));
 await reopenDocx(page,input,edited,text+' Large edit.',{timeout:120000});
 expect(errors).toEqual([]);await expect(page.locator('.canvas-message-error')).toHaveCount(0);
});
