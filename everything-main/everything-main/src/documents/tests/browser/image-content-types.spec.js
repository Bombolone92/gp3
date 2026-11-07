import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
import { expectBodyEditParts } from './helpers/expect-body-edit-parts.js';

test('renders mismatched raster payloads identically to correctly declared pictures and preserves editing',async({page},info)=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 let reference;
 for(const name of ['correct','jpeg-payload-png-name','png-payload-jpeg-name']){
  await page.goto('/playground.html');
  const input=page.getByRole('textbox',{name:'Document text'});
  const source=`tests/fixtures/image-content-types/${name}.docx`,parts=unzipSync(readFileSync(source));
  await page.getByLabel('Open DOCX file').setInputFiles(source);
  await expect(input).toHaveValue(/^Image content type controls/);await expect(input).toBeEditable();
  await expect(page.locator('canvas.canvas-page')).toHaveCount(1);
  // Wait for both distinctive picture colors, not merely text or a blank canvas.
  await page.waitForFunction(()=>{
   const c=document.querySelector('canvas.canvas-page'),d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
   let blue=0,orange=0;for(let i=0;i<d.length;i+=4){if(d[i]<45&&d[i+1]>80&&d[i+1]<110&&d[i+2]>175)blue++;if(d[i]>210&&d[i+1]>110&&d[i+1]<145&&d[i+2]<50)orange++;}
   return blue>15000&&orange>15000;
  });
  await input.blur();await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  const pixels=await page.locator('canvas.canvas-page').evaluate(c=>c.toDataURL());
  if(reference)expect(pixels).toBe(reference);else reference=pixels;
  const save=async suffix=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'-'+suffix+'.docx');await(await pending).saveAs(path);return path;};
  expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
  const original=await input.inputValue();await input.focus();await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Added ');
  const edited=await save('edited'),out=unzipSync(readFileSync(edited));expectBodyEditParts(out,parts);
  await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);
  await reopenDocx(page,input,edited,'Added '+original);await expect(input).toBeEditable();
 }
 expect(errors).toEqual([]);
});
