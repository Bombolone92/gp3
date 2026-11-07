import { test,expect } from '@playwright/test';
import { readFileSync,writeFileSync } from 'node:fs';
import { reopenDocx } from './helpers/reopen-docx.js';
const reference=JSON.parse(readFileSync('tests/fixtures/nested-tables/nested-clipping-native-ink.json','utf8'));
// Resolve the 1pt border into full-color pixels before measuring its extent.
// At DPR 1 its final two rows can both be antialiased, hiding valid border ink.
test.use({ deviceScaleFactor: 3 });
for(const mode of ['inner-exact','outer-exact','both-exact','deep','center','bottom']) test(`clips nested text and painted cells like the native reference: ${mode}`,async({page},info)=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/playground.html');
 await page.getByLabel('Open DOCX file').setInputFiles(`tests/fixtures/nested-tables/nested-clipping-${mode}.docx`);
 const input=page.getByRole('textbox',{name:'Document text'});
 await expect(input).toHaveValue(/Inner line 6/);
 const canvas=page.locator('canvas.canvas-page');await expect(canvas).toHaveCount(1);
 await page.evaluate(async()=>{await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
 const bounds=await canvas.evaluate(c=>{
   const image=c.getContext('2d').getImageData(0,0,c.width,c.height),result={};
   for(const [name,rgb] of [['outer',[255,241,168]],['inner',[201,231,181]],['deep',[180,215,255]]]) {
     let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;
     for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++) {
       const at=4*(y*c.width+x);
       if(rgb.every((v,i)=>Math.abs(image.data[at+i]-v)<=1)){left=Math.min(left,x);right=Math.max(right,x+1);top=Math.min(top,y);bottom=Math.max(bottom,y+1);}
     }
     if(Number.isFinite(left))result[name]=Object.fromEntries(Object.entries({left,top,right,bottom}).map(([k,v])=>[k,v*612/c.width]));
   }
   return result;
 });

 await canvas.screenshot({path:info.outputPath(`nested-clipping-${mode}.png`)});
 for(const [color,expected] of Object.entries(reference[mode].colors))for(const edge of ['top','bottom']) expect(Math.abs(bounds[color][edge]-expected[edge]),`${color} ${edge}`).toBeLessThan(1);
 const original=await input.inputValue();
 await input.evaluate(el=>{const at=el.value.indexOf('Inner line 6');el.focus();el.setSelectionRange(at,at+12);el.dispatchEvent(new Event('select',{bubbles:true}));});
 await page.keyboard.insertText('Hidden source edited');await expect(input).toHaveValue(/Hidden source edited/);
 const event=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();
 const path=info.outputPath(`nested-clipping-${mode}-edited.docx`);await(await event).saveAs(path);
 const edited=await input.inputValue();await reopenDocx(page,input,path,edited);
 expect(edited).toBe(original.replace('Inner line 6','Hidden source edited'));
 expect(errors).toEqual([]);
});
