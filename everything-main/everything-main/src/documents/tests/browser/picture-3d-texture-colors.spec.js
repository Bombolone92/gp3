import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {unzipSync} from 'fflate';
import {expectBodyEditParts} from './helpers/expect-body-edit-parts.js';
const root='tests/fixtures/picture-3d-textures/',device=root+'device/';
const ref=JSON.parse(readFileSync(device+'reference.json'));
const capture=JSON.parse(readFileSync(device+'capture.json','utf8').replace(/^\uFEFF/,''));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
let page,context;
test.beforeAll(async({browser})=>{
 test.setTimeout(180000);
 expect(hash(readFileSync(root+'control.docx'))).toBe(ref.sourceSha256);
 for(const [i,c] of capture.captures.entries()){
  expect(hash(gunzipSync(readFileSync(device+c.file+'.gz')))).toBe(c.sha256);
  expect(hash(readFileSync(device+ref.cases[i].png))).toBe(ref.cases[i].pngSha256);
 }
 context=await browser.newContext({deviceScaleFactor:3});page=await context.newPage();
 await page.goto('/playground.html');
 const old=await page.getByRole('textbox',{name:'Document text'}).elementHandle();
 await page.getByLabel('Open DOCX file').setInputFiles(root+'control.docx');
 await expect.poll(()=>old.evaluate(e=>e.isConnected),{timeout:120000}).toBe(false);
 await expect(page.getByRole('textbox',{name:'Document text'})).toHaveJSProperty('readOnly',false);
 await expect(page.locator('canvas.canvas-page')).toHaveCount(8);
});
test.afterAll(async()=>{await context?.close();});
for(const [i,c] of ref.cases.entries())test(`full-color native field ${c.name}`,async({},info)=>{
 const rgb=await page.locator('canvas.canvas-page').nth(i).evaluate((canvas,samples)=>{
  if(canvas.width!==2448||canvas.height!==3168)throw Error('Unexpected native comparison scale');
  const ctx=canvas.getContext('2d');return samples.map(s=>[...ctx.getImageData(Math.round(s.xPt*4),Math.round(s.yPt*4),1,1).data].slice(0,3));
 },c.samples);
 const errors=rgb.map((color,j)=>Math.max(...color.map((v,k)=>Math.abs(v-c.samples[j].rgb[k]))));
 const maximum=Math.max(...errors);
 expect(maximum,c.name).toBeLessThanOrEqual(4); // Preserve the existing dense-texture acceptance bound.
 writeFileSync(info.outputPath('color-field.json'),JSON.stringify({name:c.name,maximum,rgb,errors},null,2));
});
test('full-color controls retain editing, source media, exact undo and fresh reopen',async({},info)=>{
 test.setTimeout(180000);
 const input=page.getByRole('textbox',{name:'Document text'}),text=await input.inputValue(),parts=unzipSync(readFileSync(root+'control.docx'));
 const save=async name=>{const event=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await event).saveAs(path);return {path,parts:unzipSync(readFileSync(path))};};
 expect((await save('noedit')).parts).toEqual(parts);
 await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');
 const edited=await save('edited');expect(edited.parts['word/document.xml']).not.toEqual(parts['word/document.xml']);
 expectBodyEditParts(edited.parts,parts);
 await input.press('ControlOrMeta+z');expect((await save('undo')).parts).toEqual(parts);
 const fresh=await context.newPage();
 try{await fresh.goto('/playground.html');await fresh.getByLabel('Open DOCX file').setInputFiles(edited.path);await expect(fresh.getByRole('textbox',{name:'Document text'})).toHaveValue('Edited '+text,{timeout:120000});await expect(fresh.locator('canvas.canvas-page')).toHaveCount(8);await expect(fresh.getByRole('textbox',{name:'Document text'})).toHaveJSProperty('readOnly',false);}finally{await fresh.close();}
});
