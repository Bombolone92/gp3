import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';
const folder='tests/fixtures/path-gradients',source=`${folder}/control.docx`;
const cases=JSON.parse(readFileSync(`${folder}/cases.json`));
const reference=JSON.parse(readFileSync(`${folder}/reference.json`));

test.use({ deviceScaleFactor: 3 });

test('matches native circular gradient axes and colors through edit, undo and reopen',async({page},info)=>{
 test.setTimeout(120000);
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});
 await expect(input).toHaveValue(/^Independent circular path gradient controls/);await expect(input).toHaveJSProperty('readOnly',false);
 const check=async()=>{
  await expect(page.locator('#playground-error')).toBeEmpty();await expect(page.locator('canvas.canvas-page')).toHaveCount(2);
  const samples=await page.evaluate(({cases,reference})=>{
   const canvases=[...document.querySelectorAll('canvas.canvas-page')];
   return cases.flatMap((c,i)=>reference.cases[i].pixels.map(p=>{
    const canvas=canvases[c.page];
    if(canvas.width!==2448)throw Error('Unexpected native pixel comparison scale');
    return {i,...p,actual:[...canvas.getContext('2d').getImageData(p.x,p.y,1,1).data].slice(0,3)};
   }));
  },{cases,reference});
  for(const s of samples) {
   const c=cases[s.i],r=reference.cases[s.i];
   let rgb=s.rgb,tolerance=5;
   if(c.alpha===100000) {
    const t=Math.min(1,Math.hypot((s.x+.5)/4-c.x-r.center[0],(s.y+.5)/4-c.y-r.center[1])/r.radius);
    if(r.samples) {
     const n=t*255,i=Math.min(254,Math.floor(n)),f=n-i;
     rgb=[0,1,2].map(k=>r.samples[3*i+k]*(1-f)+r.samples[3*(i+1)+k]*f);
    } else {
     const bounds=[0,...r.bounds,1],i=Math.min(r.functions.length-1,bounds.findIndex((b,j)=>j>0&&t<=b)-1);
     const f=r.functions[i],u=(t-bounds[i])/(bounds[i+1]-bounds[i]);
     const v=r.encode[2*i]+u*(r.encode[2*i+1]-r.encode[2*i]);
     rgb=f.c0.map((a,k)=>255*(a+(f.c1[k]-a)*v**f.exponent));
    }
    tolerance=3;
   }
   rgb.forEach((v,j)=>expect(Math.abs(s.actual[j]-v),`${c.name} (${s.x},${s.y}) channel ${j}`).toBeLessThanOrEqual(tolerance));
  }
 };
 await check();writeFileSync(info.outputPath('gradients.png'),Buffer.from(await page.locator('canvas.canvas-page').first().evaluate(c=>c.toDataURL().split(',')[1]),'base64'));
 const original=await input.inputValue();await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');await check();
 const save=async label=>{const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(label+'.docx');await(await download).saveAs(path);return path;};
 const edited=await save('edited'),a=unzipSync(readFileSync(source)),b=unzipSync(readFileSync(edited));
 for(const name of Object.keys(a))if(name!=='word/document.xml')expect(b[name],name).toEqual(a[name]);
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);await check();expect(unzipSync(readFileSync(await save('undo')))).toEqual(a);
 await reopenDocx(page,input,edited,'Edited '+original);await expect(input).toHaveJSProperty('readOnly',false);await check();
});
