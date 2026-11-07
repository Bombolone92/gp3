import { test,expect } from '@playwright/test';
import { readFileSync,writeFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';
import { expectBodyEditParts } from './helpers/expect-body-edit-parts.js';
const reference=JSON.parse(readFileSync('tests/fixtures/picture-tiles/reference.json'));
test('matches native tile colors, phases, crop, DPI, clipping and retained editing',async({page},info)=>{
 test.setTimeout(120000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const source='public/fixtures/shape-picture-tiles-extended.docx';
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'}),canvases=page.locator('canvas.canvas-page');
 await expect(input).toHaveValue(/^Default tile/);await expect(input).toBeEditable();await expect(canvases).toHaveCount(23);await expect(page.locator('#playground-error')).toBeEmpty();
 const original=await input.inputValue();
 for(let i=0;i<reference.cases.length;i++){
  const canvas=canvases.nth(i);await canvas.scrollIntoViewIfNeeded();
  const sample=()=>canvas.evaluate((el,samples)=>{
   const ctx=el.getContext('2d'),scale=el.width/432;
   return samples.map(([x,y,...rgb])=>{const actual=[...ctx.getImageData(Math.floor((36+x)*scale),Math.floor((90+y)*scale),1,1).data].slice(0,3);return {x,y,actual,expected:rgb};}).filter(p=>p.actual.some((v,j)=>Math.abs(v-p.expected[j])>8));
  },reference.cases[i].samples);
  await expect.poll(sample,{message:`native tile samples page ${i+1}`}).toEqual([]);
  if([0,9,11,18].includes(i))writeFileSync(info.outputPath(`tile-${i+1}.png`),Buffer.from((await canvas.evaluate(el=>el.toDataURL())).split(',')[1],'base64'));
 }
 await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');
 const save=async name=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name);await(await pending).saveAs(path);return path;};
 const path=await save('picture-tiles.docx');
 const parts=unzipSync(readFileSync(path)),before=unzipSync(readFileSync(source));
 expectBodyEditParts(parts,before);
 await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(input).toHaveValue(original);
 expect(unzipSync(readFileSync(await save('undo-picture-tiles.docx')))).toEqual(before);
 await reopenDocx(page,input,path,'Edited '+original);await expect(input).toBeEditable();expect(errors).toEqual([]);
});
