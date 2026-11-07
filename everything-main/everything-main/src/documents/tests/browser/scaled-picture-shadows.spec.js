import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
import {expectBodyEditParts} from './helpers/expect-body-edit-parts.js';
const root='tests/fixtures/scaled-picture-shadows/',source=root+'source.docx';
test('matches native scaled picture shadow alignment, flips and small blur through editing',async({page},info)=>{
 test.setTimeout(120000);
 const ref=JSON.parse(readFileSync(root+'reference.json')),bytes=readFileSync(source);
 expect(createHash('sha256').update(bytes).digest('hex')).toBe(ref.sourceSha256);
 expect(createHash('sha256').update(readFileSync(root+'native.pdf')).digest('hex')).toBe(ref.pdfSha256);
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^align-tl/);await expect(input).toHaveJSProperty('readOnly',false);
 const check=async()=>{
  await expect(page.locator('canvas.canvas-page')).toHaveCount(ref.pages.length);
  const errors=await page.locator('canvas.canvas-page').evaluateAll((cs,pages)=>pages.map((p,i)=>{
   const c=cs[i],ctx=c.getContext('2d'),scale=c.width/432;
   return p.samples.map(([x,y,r,g,b,candidates])=>{const actual=ctx.getImageData(Math.round(x*scale),Math.round(y*scale),1,1).data;return {x,y,rgb:[r,g,b],actual:Array.from(actual).slice(0,3),error:Math.min(...candidates.map(rgb=>Math.max(...rgb.map((v,k)=>Math.abs(v-actual[k])))))};}).filter(s=>s.error>4);
  }),ref.pages);
  // The large-blur oracle below remains an explicit expected failure.
  for(const [i,errorsForPage] of errors.entries())if(ref.pages[i].name!=='soft-102-percent')expect(errorsForPage,ref.pages[i].name).toEqual([]);
 };
 await check();const original=await input.inputValue(),parts=unzipSync(bytes);
 const save=async name=>{const event=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const p=info.outputPath(name+'.docx');await(await event).saveAs(p);return p;};
 expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
 await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');const edited=await save('edited'),after=unzipSync(readFileSync(edited));
 expectBodyEditParts(after,parts);
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);await check();
 await reopenDocx(page,input,edited,'Edited '+original);await expect(input).toHaveJSProperty('readOnly',false);await check();
});

test('large picture-shadow blur matches the reference PDF export within one native texel',async({page})=>{
 test.fail(true,'Known PDF-export comparison gap. Native metafile playback has a separate ordinary regression; see the fixture README.');
 const ref=JSON.parse(readFileSync(root+'reference.json')),index=ref.pages.findIndex(p=>p.name==='soft-102-percent');
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
 await expect(page.getByRole('textbox',{name:'Document text'})).toHaveValue(/^align-tl/);
 const errors=await page.locator('canvas.canvas-page').nth(index).evaluate((c,p)=>{
  const ctx=c.getContext('2d'),scale=c.width/432;
  return p.samples.map(([x,y,r,g,b,candidates])=>{const a=ctx.getImageData(Math.round(x*scale),Math.round(y*scale),1,1).data;return Math.min(...candidates.map(rgb=>Math.max(...rgb.map((v,k)=>Math.abs(v-a[k])))));});
 },ref.pages[index]);
 expect(Math.max(...errors)).toBeLessThanOrEqual(4);
});
