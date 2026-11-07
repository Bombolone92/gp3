import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';
import { expectBodyEditParts } from './helpers/expect-body-edit-parts.js';
async function bounds(canvas) {
  return canvas.evaluate(el=>{
    const d=el.getContext('2d').getImageData(0,0,el.width,el.height).data,colors=['240,40,30','30,80,210','40,170,70','240,180,20'];
    let l=el.width,t=el.height,r=-1,b=-1;
    for(let y=0;y<el.height;y++)for(let x=0;x<el.width;x++) {const i=(y*el.width+x)*4;if(d[i+3]===255&&colors.includes(`${d[i]},${d[i+1]},${d[i+2]}`)){l=Math.min(l,x);r=Math.max(r,x);t=Math.min(t,y);b=Math.max(b,y);}}
    const scale=el.width/576;return r<0?null:[l/scale,t/scale,(r-l+1)/scale,(b-t+1)/scale];
  });
}
test('clips stretched picture fills, preserves source/destination offsets and reopens edited shapes',async({page},info)=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const source='public/fixtures/shape-picture-fills.docx';
  await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
  const input=page.getByRole('textbox',{name:'Document text'}),canvases=page.locator('canvas.canvas-page');
  await expect(input).toHaveValue(/^Full stretch/);await expect(page.locator('#playground-error')).toBeEmpty();await expect(canvases).toHaveCount(7);
  const original=await input.inputValue();let top;
  for(let i=0;i<7;i++) {
    const canvas=canvases.nth(i);await canvas.scrollIntoViewIfNeeded();await expect.poll(()=>bounds(canvas)).not.toBeNull();
    const actual=await bounds(canvas);if(i===0)top=actual[1];
    const expected=[[48,top,384,288],[48,top,384,288],[124.8,top,307.2,288],[144,top+72,192,144],[48,top,384,288],[48,top+72,288,144],[48,top,384,288]][i];
    actual.forEach((v,j)=>expect(Math.abs(v-expected[j])).toBeLessThan(2));
    const png=await canvas.evaluate(el=>el.toDataURL());writeFileSync(info.outputPath(`picture-fill-${i+1}.png`),Buffer.from(png.split(',')[1],'base64'));
  }
  const outside=await canvases.nth(6).evaluate((el,top)=>{
    const scale=el.width/576;return [...el.getContext('2d').getImageData(Math.floor((48+384*.98)*scale),Math.floor((top+288*.9)*scale),1,1).data];
  },top);expect(outside.slice(0,3)).toEqual([255,255,255]);
  await input.evaluate(el=>{const at=el.value.indexOf('\ufffc');el.focus();el.setSelectionRange(at,at+1);el.dispatchEvent(new Event('select'));});
  await input.press('Backspace');await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(input).toHaveValue(original);
  await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');
  const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();
  const saved=info.outputPath('shape-picture-fills.docx');await(await pending).saveAs(saved);
  const before=unzipSync(readFileSync(source)),after=unzipSync(readFileSync(saved));
  expectBodyEditParts(after,before);
  await reopenDocx(page,input,saved,'Edited '+original);expect(errors).toEqual([]);
});
