import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
const source='public/fixtures/group-shape-rotation.docx';
const reference=JSON.parse(readFileSync('tests/fixtures/group-shape-rotation/reference.json','utf8'));
test.use({deviceScaleFactor:3});
test('matches native nested custom-shape rotation and reflection through edits and reopening',async({page},info)=>{
 test.setTimeout(120000);
 expect(createHash('sha256').update(readFileSync(source)).digest('hex')).toBe(reference.sourceSha256);
 expect(createHash('sha256').update(readFileSync('tests/fixtures/group-shape-rotation/native.pdf')).digest('hex')).toBe(reference.pdfSha256);
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});
 await expect(input).toHaveValue(/^Shape rotation controls/,{timeout:45000});await expect(input).toHaveJSProperty('readOnly',false);
 const check=async()=>{
  await expect(page.locator('#playground-error')).toBeEmpty();await expect(page.locator('canvas.canvas-page')).toHaveCount(8);
  const actual=await page.evaluate(cases=>{
   const canvases=[...document.querySelectorAll('canvas.canvas-page')];
   return cases.map((c,i)=>{
    const canvas=canvases[c.page],ctx=canvas.getContext('2d'),scale=canvas.width/612;
    const colors=c.samples.map(([x,y])=>Array.from(ctx.getImageData(Math.round(x*scale),Math.round(y*scale),1,1).data).slice(0,3));
    const center=210+330*(i%2),x0=Math.round(100*scale),y0=Math.round((center-160)*scale),w=Math.round(410*scale),h=Math.round(320*scale);
    const data=ctx.getImageData(x0,y0,w,h).data;let l=w,t=h,r=0,b=0;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
     const n=4*(y*w+x),rgb=[data[n],data[n+1],data[n+2]];
     if(Math.max(...rgb)-Math.min(...rgb)>50){l=Math.min(l,x);t=Math.min(t,y);r=Math.max(r,x+1);b=Math.max(b,y+1);}
    }
    return {colors,bounds:[(x0+l)/scale,(y0+t)/scale,(x0+r)/scale,(y0+b)/scale]};
   });
  },reference.cases);
  reference.cases.forEach((c,i)=>{
   expect(actual[i].colors,`case ${i+1} samples`).toEqual(c.samples.map(s=>s.slice(2)));
   c.bounds.forEach((v,j)=>expect(Math.abs(actual[i].bounds[j]-v),`case ${i+1}, bound ${j}`).toBeLessThan(1));
  });
 };
 await check();
 for(const i of [0,2,7])writeFileSync(info.outputPath(`shape-rotation-${i+1}.png`),Buffer.from(await page.locator('canvas.canvas-page').nth(i).evaluate(c=>c.toDataURL().split(',')[1]),'base64'));
 const original=await input.inputValue();await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');await check();
 const save=async suffix=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(`shape-rotation-${suffix}.docx`);await(await pending).saveAs(path);return path;};
 const edited=await save('edited');await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);await check();
 expect(unzipSync(readFileSync(await save('undo')))).toEqual(unzipSync(readFileSync(source)));
 const pictures=bytes=>new TextDecoder().decode(unzipSync(bytes)['word/document.xml']).match(/<(?:[\w]+:)?wsp\b[\s\S]*?<\/(?:[\w]+:)?wsp>/g);
 expect(pictures(readFileSync(edited))).toEqual(pictures(readFileSync(source)));
 await reopenDocx(page,input,edited,'Edited '+original);await check();
});
