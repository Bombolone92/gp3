import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';

for (const fixture of ['flat-custom-shapes','flat-custom-standalone']) {
test(`${fixture}: native reference ink, editing, undo and reopen`,async({page},info)=>{
  test.setTimeout(120000);
  const reference=JSON.parse(readFileSync(`tests/fixtures/${fixture}/reference.json`,'utf8'));
  const source=readFileSync(`public/fixtures/${fixture}.docx`);
  expect(createHash('sha256').update(source).digest('hex')).toBe(reference.sourceSha256);
  expect(createHash('sha256').update(readFileSync(`tests/fixtures/${fixture}/reference.pdf`)).digest('hex')).toBe(reference.pdfSha256);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/playground.html');
  const input=page.getByRole('textbox',{name:'Document text'});
  await page.getByLabel('Open DOCX file').setInputFiles(`public/fixtures/${fixture}.docx`);
  await expect(input).toHaveValue(/Zero-extent custom shape controls/);
  await expect(input).not.toHaveAttribute('readonly');
  await expect.poll(()=>page.locator('canvas.canvas-page').count()).toBe(1);
  const measure=()=>page.evaluate(cases=>{
    const canvas=document.querySelector('canvas.canvas-page'),ctx=canvas.getContext('2d');
    const data=ctx.getImageData(0,0,canvas.width,canvas.height).data,scale=canvas.width/612;
    return cases.map(c=>{
      const rgb=[0,2,4].map(i=>parseInt(c.color.slice(i,i+2),16));
      let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;
      for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++){
        const k=(y*canvas.width+x)*4;
        if(data[k+3]&&rgb.every((v,j)=>Math.abs(data[k+j]-v)<=2)){
          left=Math.min(left,x);right=Math.max(right,x+1);top=Math.min(top,y);bottom=Math.max(bottom,y+1);
        }
      }
      return Number.isFinite(left)?[left/scale,top/scale,right/scale,bottom/scale]:null;
    });
  },reference.cases);
  await expect.poll(async()=> (await measure()).filter(Boolean).length).toBe(6);
  const bounds=await measure();
  reference.cases.forEach((c,i)=>{
    if(!c.nativeInkBoundsPt)expect(bounds[i],c.name).toBe(null);
    else c.nativeInkBoundsPt.forEach((v,j)=>expect(Math.abs(bounds[i][j]-v),c.name).toBeLessThan(.8));
  });
  const original=await input.inputValue(),parts=unzipSync(source);
  const download=async suffix=>{
    const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();
    const path=info.outputPath(`flat-custom-${suffix}.docx`);await(await pending).saveAs(path);return path;
  };
  const check=(path,edited=false)=>{
    const actual=unzipSync(readFileSync(path));expect(Object.keys(actual).sort()).toEqual(Object.keys(parts).sort());
    for(const name of Object.keys(parts))if(!edited||name!=='word/document.xml')expect(Buffer.from(actual[name]).equals(Buffer.from(parts[name])),name).toBe(true);
  };
  check(await download('noedit'));
  await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');
  const edited=await download('edited');check(edited,true);
  await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);check(await download('undo'));
  await reopenDocx(page,input,edited,'Edited '+original);
  expect(errors).toEqual([]);
});

}
