import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';

async function blueBounds(canvas) {
  return canvas.evaluate(el=>{
    const {width,height}=el,data=el.getContext('2d').getImageData(0,0,width,height).data;
    let left=width,top=height,right=-1,bottom=-1;
    for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
      const i=(y*width+x)*4;
      if(data[i]===20&&data[i+1]===80&&data[i+2]===190&&data[i+3]===255) {left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y);}
    }
    const scale=width/768;
    return right<0?null:[left/scale,top/scale,(right-left+1)/scale,(bottom-top+1)/scale];
  });
}
for(const variant of ['modern','legacy','spacing'])test(`paints, selects, edits and reopens ${variant} page/margin anchors`,async({page},info)=>{
  const legacy=variant==='legacy',name=variant==='spacing'?'anchor-spacing.docx':`anchor-position${legacy?'-legacy':''}.docx`,source=`public/fixtures/${name}`;
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
  const input=page.getByRole('textbox',{name:'Document text'}),canvases=page.locator('canvas.canvas-page');
  await expect(input).toHaveValue(/^Anchor 1: page/);await expect(canvases).toHaveCount(8);await expect(page.locator('#playground-error')).toBeEmpty();
  const original=await input.inputValue();
  const positions=[[0,0],[252,342],[legacy?468:504,684],[72,54],[234,324],[396,594],[72,36],[144,90]];
  for(let i=0;i<8;i++) {
    const canvas=canvases.nth(i);await canvas.scrollIntoViewIfNeeded();
    await expect.poll(async()=>await blueBounds(canvas)).not.toBeNull();
    const actual=await blueBounds(canvas),expected=[...positions[i].map(p=>p*4/3),96,48];
    actual.forEach((v,j)=>expect(Math.abs(v-expected[j])).toBeLessThan(1.1));
  }
  const center=canvases.nth(1);await center.scrollIntoViewIfNeeded();
  const rect=await center.boundingBox();
  await page.mouse.click(rect.x+(252+36)/576*rect.width,rect.y+(342+18)/720*rect.height);
  await expect.poll(()=>input.evaluate(el=>el.value.slice(el.selectionStart,el.selectionEnd))).toBe('\ufffc');
  await input.press('Backspace');await expect.poll(()=>blueBounds(center)).toBeNull();
  await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(input).toHaveValue(original);
  await input.press('ControlOrMeta+Home');
  const unchanged=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();
  const unchangedPath=info.outputPath('unchanged-'+name);await(await unchanged).saveAs(unchangedPath);
  expect(unzipSync(readFileSync(unchangedPath))).toEqual(unzipSync(readFileSync(source)));
  await input.press('ControlOrMeta+Home');
  await page.keyboard.insertText('Edited ');
  // Export the canvas itself so sticky toolbars cannot obscure an offscreen page.
  await canvases.nth(2).scrollIntoViewIfNeeded();
  await expect.poll(()=>blueBounds(canvases.nth(2))).not.toBeNull();
  const png=await canvases.nth(2).evaluate(el=>el.toDataURL());
  writeFileSync(info.outputPath(name.replace('.docx','.png')),Buffer.from(png.split(',')[1],'base64'));
  const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();
  const path=info.outputPath(name);await(await pending).saveAs(path);
  await reopenDocx(page,input,path,'Edited '+original);expect(errors).toEqual([]);
});
