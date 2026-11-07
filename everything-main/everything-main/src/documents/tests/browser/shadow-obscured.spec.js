import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';
import { showAllTools } from './helpers/editor-tools.js';

test('renders shadow-obscuration pictures and shapes and preserves edits and full undo',async({page},info)=>{
 await page.goto('/playground.html');await showAllTools(page);await page.getByLabel('Open DOCX file').setInputFiles('public/fixtures/shadow-obscured.docx');
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/\ufffc/);await expect(input).toHaveJSProperty('readOnly',false);await expect(page.locator('#playground-error')).toBeEmpty();
 await expect(page.locator('canvas.canvas-page')).toHaveCount(2);
 const original=await input.inputValue();await page.locator('canvas.canvas-page').first().screenshot({path:info.outputPath('shadow-obscured.png')});
 await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');await expect(input).toHaveValue('Edited '+original);
 const download=async suffix=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(`shadow-obscured${suffix}.docx`);await(await pending).saveAs(path);return path;};
 const edited=await download('-edited');await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(input).toHaveValue(original);
 const a=unzipSync(readFileSync('public/fixtures/shadow-obscured.docx')),b=unzipSync(readFileSync(await download('-undo')));for(const key of Object.keys(a))expect(Buffer.from(a[key]).equals(Buffer.from(b[key])),key).toBe(true);
 await reopenDocx(page,input,edited,'Edited '+original);await expect(page.locator('#playground-error')).toBeEmpty();
});
