import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
import {downloadDocx} from './helpers/editor-tools.js';
import {reopenDocx} from './helpers/reopen-docx.js';
import {expectBodyEditParts} from './helpers/expect-body-edit-parts.js';

test('independent shadow grid controls preserve editing, undo and export',async({page},info)=>{
 test.setTimeout(120000);
 const source='tests/fixtures/shadow-grid-boundary/source.docx';
 const parts=unzipSync(readFileSync(source));
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/playground.html');
 const input=page.getByRole('textbox',{name:'Document text'});
 const old=await input.elementHandle();
 await page.getByLabel('Open DOCX file').setInputFiles(source);
 await expect.poll(()=>old.evaluate(e=>e.isConnected)).toBe(false);
 await expect(input).toBeEditable();
 await expect(page.locator('canvas.canvas-page')).toHaveCount(16);
 const original=await input.inputValue();expect(original).toBe(Array(16).fill('\uFFFC').join('\n'));
 const save=async name=>{
  const pending=page.waitForEvent('download');await downloadDocx(page);
  const path=info.outputPath(`${name}.docx`);await(await pending).saveAs(path);return path;
 };
 expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
 await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Probe ');
 const edited=await save('edited'),after=unzipSync(readFileSync(edited));
 expectBodyEditParts(after,parts);
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);
 expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);
 await reopenDocx(page,input,edited,'Probe '+original);await expect(input).toBeEditable();
 await expect(page.locator('canvas.canvas-page')).toHaveCount(16);
 expect(errors).toEqual([]);await expect(page.locator('.canvas-message-error')).toHaveCount(0);
});
