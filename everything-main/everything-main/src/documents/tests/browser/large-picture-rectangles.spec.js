import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
import {expectBodyEditParts} from './helpers/expect-body-edit-parts.js';

test('matches native large source and destination rectangles through editable export',async({page},info)=>{
 const root='tests/fixtures/large-picture-rectangles/',source=root+'controls.docx';
 const native=JSON.parse(readFileSync(root+'native.json'));
 expect(createHash('sha256').update(readFileSync(source)).digest('hex')).toBe(native.sourceSha256);
 expect(createHash('sha256').update(readFileSync(root+'native.pdf')).digest('hex')).toBe(native.pdfSha256);
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'}),canvases=page.locator('canvas.canvas-page');
 await expect(input).toHaveValue(/^Top -1500/);await expect(input).toBeEditable();await expect(canvases).toHaveCount(8);
 const original=await input.inputValue();
 for(let i=0;i<8;i++){
  const canvas=canvases.nth(i);await canvas.scrollIntoViewIfNeeded();
  await expect.poll(()=>canvas.evaluate((el,{ref,colors,width})=>{
   const data=el.getContext('2d').getImageData(0,0,el.width,el.height).data,scale=el.width/width;
   return ref.samples.filter(([x,y,c])=>{const at=(Math.floor(y*scale)*el.width+Math.floor(x*scale))*4;return colors[c].some((v,j)=>Math.abs(v-data[at+j])>2);}).slice(0,5);
  },{ref:native.pages[i],colors:native.colors,width:native.pagePixels[0]}),{message:`native page ${i+1}`}).toEqual([]);
 }
 const save=async name=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await pending).saveAs(path);return path;};
 const parts=unzipSync(readFileSync(source));expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
 await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');
 const text=await input.inputValue(),edited=await save('edited');
 expectBodyEditParts(unzipSync(readFileSync(edited)),parts);
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);
 await reopenDocx(page,input,edited,text);await expect(input).toBeEditable();await expect(canvases).toHaveCount(8);await expect(page.locator('#playground-error')).toBeEmpty();
});
