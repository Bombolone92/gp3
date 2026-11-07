import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {expectBodyEditParts} from './helpers/expect-body-edit-parts.js';
const root='tests/fixtures/picture-3d-textures/';
const ref=JSON.parse(readFileSync(root+'reference.json'));
test.describe.configure({mode:'serial'});
let page;
test.beforeAll(async({browser})=>{
 test.setTimeout(180000);
 for(const [file,hash]of [['control.docx',ref.sourceSha256],['native.pdf',ref.pdfSha256]])expect(createHash('sha256').update(readFileSync(root+file)).digest('hex')).toBe(hash);
 page=await browser.newPage();await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(root+'control.docx');
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^gray-front/,{timeout:120000});await expect(input).toHaveJSProperty('readOnly',false);
 await expect(page.locator('canvas.canvas-page')).toHaveCount(ref.cases.length);
});
test.afterAll(async()=>{await page?.close();});
for(const [i,c]of ref.cases.entries())test(`native dense texture field ${c.name}`,async({},info)=>{
 test.fail(c.texture==='gradient'&&c.camera!=='perspectiveLeft','Unresolved dense-color comparison; native gradient images use lossy JPEG. No renderer correction is justified yet.');
 const canvas=page.locator('canvas.canvas-page').nth(i);
 const rgb=await canvas.evaluate((canvas,samples)=>{const ctx=canvas.getContext('2d'),scale=canvas.width/612;return samples.map(p=>[...ctx.getImageData(Math.round(p.xPt*scale),Math.round(p.yPt*scale),1,1).data].slice(0,3));},c.samples);
 const errors=rgb.map((color,j)=>Math.max(...color.map((v,k)=>Math.abs(v-c.samples[j].rgb[k]))));
 writeFileSync(info.outputPath('color-field.json'),JSON.stringify({name:c.name,maximum:Math.max(...errors),rgb,errors},null,2));
 writeFileSync(info.outputPath(c.name+'.png'),Buffer.from((await canvas.evaluate(c=>c.toDataURL())).split(',')[1],'base64'));
 expect(Math.max(...errors),c.name).toBeLessThanOrEqual(4);
});
test('dense texture control retains picture parts through editing and exact undo',async({},info)=>{
 test.setTimeout(180000);
 const input=page.getByRole('textbox',{name:'Document text'}),text=await input.inputValue(),parts=unzipSync(readFileSync(root+'control.docx'));
 const save=async name=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await pending).saveAs(path);return {path,parts:unzipSync(readFileSync(path))};};
 expect((await save('noedit')).parts).toEqual(parts);await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');
 const edited=await save('edited');expectBodyEditParts(edited.parts,parts);
 await input.press('ControlOrMeta+z');expect((await save('undo')).parts).toEqual(parts);
 page.once('dialog',d=>d.accept());await page.getByLabel('Open DOCX file').setInputFiles(edited.path);await expect(input).toHaveValue('Edited '+text,{timeout:120000});
 await expect(input).toHaveJSProperty('readOnly',false);await expect(page.locator('canvas.canvas-page')).toHaveCount(8);await expect(page.locator('#playground-error')).toBeEmpty();
});
