import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';

test('24 native rotated text controls: physical glyph bounds, upright wrapping and round trips',async({page},info)=>{
  const folder='tests/fixtures/rotated-shape-text/';
  const reference=JSON.parse(readFileSync(folder+'reference.json')),source=readFileSync(folder+'control.docx');
  const hash=b=>createHash('sha256').update(b).digest('hex');
  expect(hash(source)).toBe(reference.sourceSha256);expect(hash(readFileSync(folder+'reference.pdf'))).toBe(reference.pdfSha256);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/playground.html');
  await page.getByLabel('Open DOCX file').setInputFiles(folder+'control.docx');
  const input=page.getByRole('textbox',{name:'Document text'});
  await expect(input).toHaveValue(/^Independent visible/);await expect(input).toHaveJSProperty('readOnly',false);
  await expect(page.locator('canvas.canvas-page')).toHaveCount(2);
  const measure=()=>page.evaluate(cases=>cases.map(c=>{
    const canvas=document.querySelectorAll('canvas.canvas-page')[c.page-1],ctx=canvas.getContext('2d'),scale=canvas.width/612;
    const data=ctx.getImageData(0,0,canvas.width,canvas.height).data;
    let l=Infinity,t=Infinity,r=-Infinity,b=-Infinity;
    const [left,top,right,bottom]=c.regionPt.map(v=>Math.round(v*scale));
    for(let y=top;y<bottom;y++)for(let x=left;x<right;x++){
      const k=(y*canvas.width+x)*4,red=data[k],green=data[k+1],blue=data[k+2];
      if(data[k+3]&&blue-red>25&&green-red>12&&red<150){l=Math.min(l,x);t=Math.min(t,y);r=Math.max(r,x+1);b=Math.max(b,y+1);}
    }
    return Number.isFinite(l)?[l/scale,t/scale,r/scale,b/scale]:null;
  }),reference.cases);
  await expect.poll(async()=>(await measure()).filter(Boolean).length).toBe(24);
  const bounds=await measure();writeFileSync(info.outputPath('text-bounds.json'),JSON.stringify(bounds));
  for(const [i,c] of reference.cases.entries())for(let j=0;j<4;j++)expect(Math.abs(bounds[i][j]-c.nativeTextBoundsPt[j]),`case ${c.index}, bound ${j}`).toBeLessThan(1);
  const original=await input.inputValue(),parts=unzipSync(source);
  const save=async(name,edited=false)=>{
    const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();
    const path=info.outputPath(name+'.docx');await(await pending).saveAs(path);const out=unzipSync(readFileSync(path));
    expect(Object.keys(out).sort()).toEqual(Object.keys(parts).sort());
    for(const n of Object.keys(parts))if(!edited||n!=='word/document.xml')expect(Buffer.from(out[n]).equals(Buffer.from(parts[n])),n).toBe(true);
    return path;
  };
  await save('noedit');await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');
  const edited=await save('edited',true);await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);await save('undo');
  await reopenDocx(page,input,edited,'Edited '+original);expect(errors).toEqual([]);
});
