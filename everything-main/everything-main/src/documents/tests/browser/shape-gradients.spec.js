import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';
const folder='tests/fixtures/shape-gradients',source=`${folder}/control.docx`;
const cases=JSON.parse(readFileSync(`${folder}/cases.json`));
const reference=JSON.parse(readFileSync(`${folder}/reference.json`));

test('matches native gradient axes and colors through edit, undo and reopen',async({page},info)=>{
 test.setTimeout(120000);
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});
 await expect(input).toHaveValue(/^Independent linear gradient controls/);await expect(input).toHaveJSProperty('readOnly',false);
 const check=async()=>{
  await expect(page.locator('#playground-error')).toBeEmpty();await expect(page.locator('canvas.canvas-page')).toHaveCount(1);
  const samples=await page.evaluate(cases=>{
   const canvas=document.querySelector('canvas.canvas-page'),ctx=canvas.getContext('2d'),scale=canvas.width/612;
   return cases.flatMap((c,i)=>[.2,.5,.8].flatMap(x=>[.2,.5,.8].map(y=>{
    const px=Math.floor((c.x+c.width*x)*scale),py=Math.floor((c.y+c.height*y)*scale);
    return {i,x:(px+.5)/scale-c.x,y:(py+.5)/scale-c.y,color:[...ctx.getImageData(px,py,1,1).data].slice(0,3)};
   })));
  },cases);
  for(const s of samples){
   const r=reference.cases[s.i],dx=r.end[0]-r.start[0],dy=r.end[1]-r.start[1];
   const t=Math.max(0,Math.min(1,((s.x-r.start[0])*dx+(s.y-r.start[1])*dy)/(dx*dx+dy*dy)));
   const rgb=t<.5?[255*(1-2*t),510*t,0]:[0,510*(1-t),255*(2*t-1)];
   rgb.forEach((v,j)=>expect(Math.abs(s.color[j]-v),`${cases[s.i].name}, ${s.x}, ${s.y}, channel ${j}`).toBeLessThanOrEqual(3));
  }
 };
 await check();writeFileSync(info.outputPath('gradients.png'),Buffer.from(await page.locator('canvas.canvas-page').evaluate(c=>c.toDataURL().split(',')[1]),'base64'));
 const original=await input.inputValue();await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');await check();
 const save=async label=>{const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(label+'.docx');await(await download).saveAs(path);return path;};
 const edited=await save('edited'),a=unzipSync(readFileSync(source)),b=unzipSync(readFileSync(edited));
 for(const name of Object.keys(a))if(name!=='word/document.xml')expect(b[name],name).toEqual(a[name]);
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);await check();expect(unzipSync(readFileSync(await save('undo')))).toEqual(a);
 await reopenDocx(page,input,edited,'Edited '+original);await expect(input).toHaveJSProperty('readOnly',false);await check();
});
