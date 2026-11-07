import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';
test.use({deviceScaleFactor:3});
for (const fixture of ['shape-flips']) {
const reference=JSON.parse(readFileSync(`tests/fixtures/${fixture}/reference.json`,'utf8'));

test(`matches native ${fixture} cross-sections, outside-frame ink and round trips`,async({page},info)=>{
 expect(createHash('sha256').update(readFileSync(`public/fixtures/${fixture}.docx`)).digest('hex')).toBe(reference.sourceSha256);
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(`public/fixtures/${fixture}.docx`);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^Shape flip geometry/);await expect(input).toHaveJSProperty('readOnly',false);await expect(page.locator('#playground-error')).toBeEmpty();
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
 const axes=await page.evaluate(async()=>{
  const {DocxPackage}=await import('/src/engine/docx.js');const {decodeShape}=await import('/src/engine/canvas-shapes.js');
  const pkg=await DocxPackage.open(new Uint8Array(await(await fetch('/fixtures/shape-flips.docx')).arrayBuffer()));
  const original=OffscreenCanvasRenderingContext2D.prototype.fillText,axes=[];
  OffscreenCanvasRenderingContext2D.prototype.fillText=function(text,...args){if(text==='Abc'){const m=this.getTransform();axes.push([m.a/2,m.d/2]);}return original.call(this,text,...args);};
  try{for(const a of Object.values(pkg.assets)){const d=await decodeShape(a,new Map());d.close();}}finally{OffscreenCanvasRenderingContext2D.prototype.fillText=original;}
  return axes;
 });
 expect(axes).toHaveLength(6);for(const [i,pair] of axes.entries())for(const j of [0,1])expect(pair[j]).toBeCloseTo(reference.cases[i].textAxes[j]);
 await check();writeFileSync(info.outputPath('shape-flips.png'), Buffer.from(await page.locator('canvas.canvas-page').evaluate(canvas=>canvas.toDataURL().split(',')[1]), 'base64'));
 const original=await input.inputValue();await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');await check();
 const save=async suffix=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(`shape-flips${suffix}.docx`);await(await pending).saveAs(path);return path;};
 const edited=await save('-edited');await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);await check();
 const a=unzipSync(readFileSync(`public/fixtures/${fixture}.docx`)),b=unzipSync(readFileSync(await save('-undo')));for(const name of Object.keys(a))expect(Buffer.from(a[name]).equals(Buffer.from(b[name])),name).toBe(true);
 await reopenDocx(page,input,edited,'Edited '+original);await check();
});


}
