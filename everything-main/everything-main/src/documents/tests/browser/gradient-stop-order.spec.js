import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync,strFromU8} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
const root='tests/fixtures/gradient-stop-order/',source=root+'control.docx';
test('matches native stop permutations and stable ties while retaining original XML order',async({page},info)=>{
 test.setTimeout(120000);
 const bytes=readFileSync(source),ref=JSON.parse(readFileSync(root+'reference.json'));
 expect(createHash('sha256').update(bytes).digest('hex')).toBe(ref.sourceSha256);
 expect(createHash('sha256').update(readFileSync(root+'native.pdf')).digest('hex')).toBe(ref.pdfSha256);
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^Independent gradient stop order/);await expect(input).toHaveJSProperty('readOnly',false);
 const check=async()=>{
  await expect(page.locator('canvas.canvas-page')).toHaveCount(1);
  const errors=await page.locator('canvas.canvas-page').evaluate((c,cases)=>{
   const ctx=c.getContext('2d'),scale=c.width/612;
   return cases.map(p=>({name:p.name,errors:p.samples.map(s=>{const rgb=ctx.getImageData(Math.floor(s.x*scale),Math.floor(s.y*scale),1,1).data;return Math.max(...s.rgb.map((v,i)=>Math.abs(v-rgb[i])));})}));
  },ref.cases);
  for(const c of errors)expect(Math.max(...c.errors),c.name).toBeLessThanOrEqual(3);
 };
 await check();const original=await input.inputValue(),parts=unzipSync(bytes);
 const save=async name=>{const event=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const p=info.outputPath(name+'.docx');await(await event).saveAs(p);return p;};
 const order=part=>Array.from(strFromU8(part).matchAll(/<a:gs\s[^>]*\bpos="([^"]+)"/g),m=>m[1]);
 expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
 await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');const edited=await save('edited'),after=unzipSync(readFileSync(edited));
 expect(order(after['word/document.xml'])).toEqual(order(parts['word/document.xml']));
 for(const [n,b] of Object.entries(parts))if(n!=='word/document.xml')expect(after[n]).toEqual(b);
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);await check();
 await reopenDocx(page,input,edited,'Edited '+original);await expect(input).toHaveJSProperty('readOnly',false);await check();
});
