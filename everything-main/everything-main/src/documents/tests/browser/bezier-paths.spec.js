import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';
test.use({deviceScaleFactor:3});
for (const fixture of ['bezier-paths', 'bezier-close-paths', 'empty-drawing-paths']) {
const reference=JSON.parse(readFileSync(`tests/fixtures/${fixture}/reference.json`,'utf8'));

test(`matches native ${fixture} cross-sections, outside-frame ink and round trips`,async({page},info)=>{
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(`public/fixtures/${fixture}.docx`);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^Bezier geometry/);await expect(input).toHaveJSProperty('readOnly',false);await expect(page.locator('#playground-error')).toBeEmpty();
 const check=async()=>{
  await expect(page.locator('canvas.canvas-page')).toHaveCount(1);
  const actual=await page.evaluate(cases=>{
   const canvas=document.querySelector('canvas.canvas-page'),ctx=canvas.getContext('2d'),scale=canvas.width/612;
   return cases.map(c=>c.rows.map(row=>{const intervals=[],y=Math.round(row.y*scale);
    for(let x=Math.round((c.x-60)*scale);x<Math.round((c.x+180)*scale);x++){
     const p=ctx.getImageData(x,y,1,1).data;if(Math.abs(p[0]-32)+Math.abs(p[1]-128)+Math.abs(p[2]-96)<30){
      if(intervals.length&&x<=intervals.at(-1)[1]+1)intervals.at(-1)[1]=x+1;else intervals.push([x,x+1]);
     }
    }return intervals.map(pair=>pair.map(x=>x/scale));
   }));
  },reference.cases);
  for(const [i,c] of reference.cases.entries())for(const [j,row] of c.rows.entries()){
   expect(actual[i][j].length,`${c.name} y=${row.y}`).toBe(row.intervals.length);
   for(const [k,pair] of row.intervals.entries())for(const end of [0,1])expect(Math.abs(actual[i][j][k][end]-pair[end]),`${c.name} y=${row.y} edge`).toBeLessThanOrEqual(.75);
  }
 };
 await check();writeFileSync(info.outputPath('bezier-paths.png'), Buffer.from(await page.locator('canvas.canvas-page').evaluate(canvas=>canvas.toDataURL().split(',')[1]), 'base64'));
 const original=await input.inputValue();await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');await check();
 const save=async suffix=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(`bezier-paths${suffix}.docx`);await(await pending).saveAs(path);return path;};
 const edited=await save('-edited');await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);await check();
 const a=unzipSync(readFileSync(`public/fixtures/${fixture}.docx`)),b=unzipSync(readFileSync(await save('-undo')));for(const name of Object.keys(a))expect(Buffer.from(a[name]).equals(Buffer.from(b[name])),name).toBe(true);
 await reopenDocx(page,input,edited,'Edited '+original);await check();
});


}
