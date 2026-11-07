import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync,strFromU8} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
const root='tests/fixtures/native-face-selection/',source=root+'control.docx';
test('matches native exact-face advances across styles while preserving editing and source fonts',async({page},info)=>{
 test.setTimeout(120000);
 const bytes=readFileSync(source),ref=JSON.parse(readFileSync(root+'reference.json'));
 expect(createHash('sha256').update(bytes).digest('hex')).toBe(ref.sourceSha256);
 expect(createHash('sha256').update(readFileSync(root+'native.pdf')).digest('hex')).toBe(ref.pdfSha256);
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^Hamburgefontsiv/);await expect(input).toHaveJSProperty('readOnly',false);
 const check=async()=>{
  await expect(page.locator('canvas.canvas-page')).toHaveCount(1);
  const errors=await page.evaluate(async cases=>{
   const {measureCanvasText}=await import('/src/engine/canvas-text.js');
   const ctx=document.createElement('canvas').getContext('2d');
   return cases.map(c=>({name:c.family+' '+c.bold+' '+c.italic,error:measureCanvasText(ctx,c.text.slice(0,-1),{fontFamily:c.family,fontSize:18,bold:c.bold,italic:c.italic}).width*.75-c.advance}));
  },ref.cases);
  for(const c of errors)expect(Math.abs(c.error),JSON.stringify(c)).toBeLessThan(.25);
 };
 await check();const original=await input.inputValue(),parts=unzipSync(bytes);
 const save=async name=>{const event=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const p=info.outputPath(name+'.docx');await(await event).saveAs(p);return p;};
 const order=part=>Array.from(strFromU8(part).matchAll(/<w:rFonts\s[^>]+/g),m=>m[0]);
 expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
 await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');const edited=await save('edited'),after=unzipSync(readFileSync(edited));
 expect(order(after['word/document.xml'])).toEqual(order(parts['word/document.xml']));
 for(const [n,b] of Object.entries(parts))if(n!=='word/document.xml')expect(after[n]).toEqual(b);
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);await check();
 await reopenDocx(page,input,edited,'Edited '+original);await expect(input).toHaveJSProperty('readOnly',false);await check();
});
