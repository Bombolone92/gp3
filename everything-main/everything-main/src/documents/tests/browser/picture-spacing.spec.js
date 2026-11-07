import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
const source='public/fixtures/picture-spacing.docx';
const reference=JSON.parse(readFileSync('tests/fixtures/picture-spacing/reference.json'));
test('retains picture spacing while matching native picture advances through edit and reopen',async({page},info)=>{
 test.setTimeout(120000);
 for(const [file,hash] of [[source,reference.sourceSha256],['tests/fixtures/picture-spacing/native.pdf',reference.pdfSha256]])expect(createHash('sha256').update(readFileSync(file)).digest('hex')).toBe(hash);
 await page.addInitScript(()=>{window.pictureFollowing={};const original=CanvasRenderingContext2D.prototype.fillText;CanvasRenderingContext2D.prototype.fillText=function(text,x,y,...rest){if(/^NEXT\d$/.test(text))window.pictureFollowing[text]=x;return original.call(this,text,x,y,...rest);};});
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/NEXT4/,{timeout:45000});await expect(input).toHaveJSProperty('readOnly',false);
 const check=async()=>{await expect(page.locator('#playground-error')).toBeEmpty();await expect(page.locator('canvas.canvas-page')).toHaveCount(1);await expect.poll(()=>page.evaluate(()=>Object.keys(window.pictureFollowing).length)).toBe(5);const positions=await page.evaluate(()=>window.pictureFollowing);for(const c of reference.cases)expect(Math.abs(positions[c.id]*.75-c.x)).toBeLessThan(.1);};
 await check();const original=await input.inputValue();await input.press('ControlOrMeta+End');await page.keyboard.insertText(' Edited');await check();
 const save=async suffix=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath('picture-spacing-'+suffix+'.docx');await(await pending).saveAs(path);return path;};
 const edited=await save('edited');await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);await check();
 const a=unzipSync(readFileSync(source)),b=unzipSync(readFileSync(await save('undo')));expect(Object.keys(b).sort()).toEqual(Object.keys(a).sort());for(const n of Object.keys(a))expect(Buffer.from(a[n]).equals(Buffer.from(b[n])),n).toBe(true);
 page.once('dialog',d=>d.accept());const prior=await input.elementHandle();await page.getByLabel('Open DOCX file').setInputFiles(edited);await expect.poll(()=>prior.evaluate(el=>el.isConnected)).toBe(false);await prior.dispose();await expect(input).toHaveValue(original+' Edited');await expect(input).toHaveJSProperty('readOnly',false);await check();
});
