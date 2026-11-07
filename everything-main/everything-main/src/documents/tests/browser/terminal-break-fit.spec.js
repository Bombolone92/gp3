import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';
const reference=JSON.parse(readFileSync('tests/fixtures/terminal-break-fit/reference.json','utf8'));
for(const c of reference)test(`matches native break fit ${c.name} through edit, reopen and undo`,async({page},info)=>{
 test.setTimeout(90000);
 const source=`public/fixtures/terminal-break-${c.name}.docx`;
 expect(createHash('sha256').update(readFileSync(source)).digest('hex')).toBe(c.sourceSha256);
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/After/);await expect(input).toHaveJSProperty('readOnly',false);
 const check=async()=>{await expect(page.locator('canvas.canvas-page')).toHaveCount(c.pages);await expect(page.locator('#playground-error')).toBeEmpty();};
 await check();const original=await input.inputValue();await input.press('ControlOrMeta+End');await input.press('ControlOrMeta+Shift+ArrowLeft');await page.keyboard.insertText('Later');await expect(input).toHaveValue(original.replace('After','Later'));await check();
 const save=async name=>{const event=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name);await(await event).saveAs(path);return path;};
 const edited=await save('edited.docx');await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);await check();
 const a=unzipSync(readFileSync(source)),b=unzipSync(readFileSync(await save('undo.docx'))),e=unzipSync(readFileSync(edited));
 for(const name of Object.keys(a)){expect(Buffer.from(a[name]).equals(Buffer.from(b[name])),name).toBe(true);if(name!=='word/document.xml')expect(Buffer.from(a[name]).equals(Buffer.from(e[name])),name).toBe(true);}
 await reopenDocx(page,input,edited,original.replace('After','Later'));await check();
});
