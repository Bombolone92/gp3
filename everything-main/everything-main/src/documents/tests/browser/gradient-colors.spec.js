import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
test.use({deviceScaleFactor:3});
for(const name of ['gradient-colors','gradient-color-edges']){
 const folder=`tests/fixtures/${name}`,source=`${folder}/control.docx`;
 test(`${name} matches the native reference through editing, exact undo and reopen`,async({page},info)=>{
  test.setTimeout(120000);
  const bytes=readFileSync(source),reference=JSON.parse(readFileSync(`${folder}/reference.json`));
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(reference.sourceSha256);
  expect(createHash('sha256').update(readFileSync(`${folder}/native.pdf`)).digest('hex')).toBe(reference.pdfSha256);
  await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
  const input=page.getByRole('textbox',{name:'Document text'});
  await expect(input).toHaveValue(/^Independent linear gradient controls/);await expect(input).toHaveJSProperty('readOnly',false);
  const check=async()=>{
   await expect(page.locator('#playground-error')).toBeEmpty();await expect(page.locator('canvas.canvas-page')).toHaveCount(1);
   const errors=await page.locator('canvas.canvas-page').evaluate((c,samples)=>{
    const ctx=c.getContext('2d'),scale=c.width/612;
    return samples.map(s=>{const color=ctx.getImageData(Math.floor(s.x*scale),Math.floor(s.y*scale),1,1).data;return {case:s.case,x:s.x,y:s.y,actual:[...color].slice(0,3),native:s.color,error:Math.max(...s.color.map((v,i)=>Math.abs(v-color[i])))};});
   },reference.samples);
   writeFileSync(info.outputPath('samples.json'),JSON.stringify(errors,null,2));
   expect(errors.filter(e=>e.error>4)).toEqual([]);
  };
  await check();writeFileSync(info.outputPath('page.png'),Buffer.from(await page.locator('canvas.canvas-page').evaluate(c=>c.toDataURL().split(',')[1]),'base64'));
  const original=await input.inputValue(),parts=unzipSync(bytes);
  const save=async label=>{const event=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(label+'.docx');await(await event).saveAs(path);return path;};
  expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
  await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');await check();
  const edited=await save('edited'),after=unzipSync(readFileSync(edited));
  const gradients=data=>new TextDecoder().decode(data).match(/<a:gradFill\b[\s\S]*?<\/a:gradFill>/g);
  expect(gradients(after['word/document.xml'])).toEqual(gradients(parts['word/document.xml']));
  for(const [n,b] of Object.entries(parts))if(n!=='word/document.xml')expect(after[n]).toEqual(b);
  await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);await check();
  await reopenDocx(page,input,edited,'Edited '+original);await expect(input).toHaveJSProperty('readOnly',false);await check();
 });
}
