import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const folder='tests/fixtures/border-phase/';
const ref=JSON.parse(readFileSync(folder+'native-fill-reference.json'));
test.describe.configure({timeout:120000});
for(const c of ref.controls)for(const o of c.observations)test(`${c.source} native fill bounds at ${o.zoom}%`,async({page},info)=>{
 for(const [name,hash]of [[c.source,c.sourceSha256],[c.cases,c.casesSha256],[o.crop,o.cropSha256]])
  expect(createHash('sha256').update(readFileSync(folder+name)).digest('hex'),name).toBe(hash);
 await page.goto('/playground.html');const old=await page.getByRole('textbox',{name:'Document text'}).elementHandle();
 await page.getByLabel('Open DOCX file').setInputFiles(folder+c.source);
 await expect.poll(()=>old.evaluate(e=>e.isConnected),{timeout:45000}).toBe(false);
 await expect(page.getByRole('textbox',{name:'Document text'})).toHaveJSProperty('readOnly',false);
 await expect(page.locator('canvas.canvas-page')).toHaveCount(1);
 await page.getByRole('combobox',{name:'Zoom'}).selectOption(String(o.zoom/100));
 const result=await page.locator('canvas.canvas-page').evaluate(async(canvas,regions)=>{
  await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  const ctx=canvas.getContext('2d');return regions.map(([x,y,w,h])=>{
   const d=ctx.getImageData(x,y,w,h).data;let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;
   for(let yy=0;yy<h;yy++)for(let xx=0;xx<w;xx++){
    const i=(yy*w+xx)*4,r=d[i],g=d[i+1],b=d[i+2];
    if(.299*r+.587*g+.114*b<166 && r>128 && r>g+32 && r>b+32){left=Math.min(left,x+xx);top=Math.min(top,y+yy);right=Math.max(right,x+xx+1);bottom=Math.max(bottom,y+yy+1);}
   }
   return [left,top,right,bottom];
  });
 },o.regions);
 expect(result).toHaveLength(16);expect(result.flat().every(Number.isFinite)).toBe(true);
 writeFileSync(info.outputPath('bounds.json'),JSON.stringify({source:c.source,zoom:o.zoom,actual:result,native:o.comparisons.map(c=>c.native)},null,2));
 // All 256 native edges pass. A later mismatch must be an ordinary failure;
 // never choose expected-failure status from the result being tested.
 expect(result).toEqual(o.comparisons.map(c=>c.native));
});
