import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
const folder='tests/fixtures/border-phase/';
test.describe.configure({timeout:120000});
for(const name of ['control','holdout','reordered','heights-thin','heights-wide']){
const ref=name.startsWith('heights-')?JSON.parse(readFileSync(folder+'native-height-reference.json')).controls.find(c=>c.source===name+'.docx'):
JSON.parse(readFileSync(folder+(name==='control'?'reference.json':`native-${name}-reference.json`)));
if(name==='control')ref.observations.push(...JSON.parse(readFileSync(folder+'native-intermediate-reference.json')).observations);
for(const o of ref.observations)test(`native ${name} single table-border frame placement at ${o.zoom}%`,async({page},info)=>{
 await page.goto('/playground.html');const old=await page.getByRole('textbox',{name:'Document text'}).elementHandle();
 await page.getByLabel('Open DOCX file').setInputFiles(folder+name+'.docx');
 await expect.poll(()=>old.evaluate(e=>e.isConnected),{timeout:45000}).toBe(false);
 await expect(page.getByRole('textbox',{name:'Document text'})).toHaveJSProperty('readOnly',false);
 await expect(page.locator('canvas.canvas-page')).toHaveCount(1);
 await page.getByRole('combobox',{name:'Zoom'}).selectOption(String(o.zoom/100));
 const result=await page.locator('canvas.canvas-page').evaluate(async(canvas,regions)=>{
  await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  const ctx=canvas.getContext('2d');return regions.map(([x,y,w,h])=>{
   const d=ctx.getImageData(x,y,w,h).data;let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;
   for(let yy=0;yy<h;yy++)for(let xx=0;xx<w;xx++){const i=(yy*w+xx)*4;if(Math.max(d[i],d[i+1],d[i+2])<128){left=Math.min(left,x+xx);top=Math.min(top,y+yy);right=Math.max(right,x+xx+1);bottom=Math.max(bottom,y+yy+1);}}
   return [left,top,right,bottom];
  });
 },o.regions);
 expect(result).toHaveLength(16);expect(result.flat().every(Number.isFinite)).toBe(true);
 writeFileSync(info.outputPath('bounds.json'),JSON.stringify({zoom:o.zoom,actual:result,native:o.comparisons.map(c=>c.native)},null,2));
 // Six observations already match on the pre-change engine and are normal
 // assertions; the 100% holdout now matches after the minimum bottom fix.
 // Remaining native placement gaps retain explicit expected failures;
 // loading and geometry extraction above must always succeed.
 const verified = name.startsWith('heights-') || ['control','holdout','reordered'].includes(name) && o.zoom === 100;
 test.fail(!verified,'Native phase/placement discrepancy is unresolved; do not shift individual templates.');
 expect(result).toEqual(o.comparisons.map(c=>c.native));
});
}
