import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {unzipSync} from 'fflate';
import {expectBodyEditParts} from './helpers/expect-body-edit-parts.js';
const root='tests/fixtures/picture-3d-sampling/',ref=JSON.parse(readFileSync(root+'native.json'));
let page,context;
test.beforeAll(async({browser})=>{
 test.setTimeout(180000);
 expect(createHash('sha256').update(readFileSync(root+'control.docx')).digest('hex')).toBe(ref.capture.sourceSha256);
 for(const c of ref.capture.captures)expect(createHash('sha256').update(gunzipSync(readFileSync(root+c.file+'.gz'))).digest('hex')).toBe(c.sha256);
 context=await browser.newContext({deviceScaleFactor:3});page=await context.newPage();await page.goto('/playground.html');
 const old=await page.getByRole('textbox',{name:'Document text'}).elementHandle();await page.getByLabel('Open DOCX file').setInputFiles(root+'control.docx');
 await expect.poll(()=>old.evaluate(e=>e.isConnected),{timeout:120000}).toBe(false);
 await expect(page.getByRole('textbox',{name:'Document text'})).toHaveJSProperty('readOnly',false);
 await expect(page.locator('canvas.canvas-page')).toHaveCount(6);
});
test.afterAll(async()=>{await context?.close();});
for(const [i,c]of ref.cases.entries())test(`native texture minification ${c.name}`,async({},info)=>{
 const rgb=await page.locator('canvas.canvas-page').nth(i).evaluate(canvas=>{
  if(canvas.width!==2448||canvas.height!==3168)throw Error('Unexpected raster scale');
  return [...canvas.getContext('2d').getImageData(560,700,240,140).data].filter((_,i)=>i%4!==3);
 });
 const mean=rgb.reduce((a,b)=>a+b,0)/rgb.length,std=Math.sqrt(rgb.reduce((n,v)=>n+(v-mean)**2,0)/rgb.length);
 const native=gunzipSync(readFileSync(root+ref.capture.captures[i].file+'.rgb.gz'));
 expect(createHash('sha256').update(native).digest('hex')).toBe(c.nativeRgbSha256);
 expect(native.length).toBe(rgb.length);
 const meanAbsError=rgb.reduce((n,v,j)=>n+Math.abs(v-native[j]),0)/rgb.length;
 expect(meanAbsError).toBeLessThanOrEqual(c.texture==='coarse'?c.baselineMeanAbsError+0.01:2.5);
 expect(Math.abs(mean-c.nativeMean)).toBeLessThanOrEqual(3);
 if(c.texture!=='coarse')expect(std).toBeLessThanOrEqual(c.nativeStd+2);
 else {expect(Math.abs(std-c.nativeStd)).toBeLessThanOrEqual(4);if(c.baselineRgbSha256)expect(createHash('sha256').update(Uint8Array.from(rgb)).digest('hex')).toBe(c.baselineRgbSha256);}
 writeFileSync(info.outputPath('sampling.json'),JSON.stringify({mean,std,meanAbsError,nativeMean:c.nativeMean,nativeStd:c.nativeStd}));
});
 test('editing preserves all other parts, exact undo and fresh reopening',async({},info)=>{
  test.setTimeout(180000);
  const input=page.getByRole('textbox',{name:'Document text'}),text=await input.inputValue(),parts=unzipSync(readFileSync(root+'control.docx'));
  const save=async name=>{const event=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await event).saveAs(path);return {path,parts:unzipSync(readFileSync(path))};};
  expect((await save('noedit')).parts).toEqual(parts);
  await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');
  const edited=await save('edited');expect(edited.parts['word/document.xml']).not.toEqual(parts['word/document.xml']);
  expectBodyEditParts(edited.parts,parts);
  await input.press('ControlOrMeta+z');expect((await save('undo')).parts).toEqual(parts);
  const fresh=await page.context().newPage();
  try{await fresh.goto('/playground.html',{timeout:120000});await fresh.getByLabel('Open DOCX file').setInputFiles(edited.path);await expect(fresh.getByRole('textbox',{name:'Document text'})).toHaveValue('Edited '+text,{timeout:120000});await expect(fresh.locator('canvas.canvas-page')).toHaveCount(6);await expect(fresh.getByRole('textbox',{name:'Document text'})).toHaveJSProperty('readOnly',false);}finally{await fresh.close();}
 });
