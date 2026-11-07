import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';
const folder='tests/fixtures/book-fold/';
const reference=JSON.parse(readFileSync(folder+'reference.json','utf8'));

test('matches native booklet reading pages and preserves edit/export/undo',async({page},info)=>{
 test.setTimeout(300000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 for(const c of reference.cases){
  await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(folder+c.name+'.docx');
  const input=page.getByRole('textbox',{name:'Document text'});
  await expect(input).toHaveValue(/^Page 1 left edge/,{timeout:60000});await expect(input).toHaveJSProperty('readOnly',false);
  await expect(page.locator('canvas.canvas-page')).toHaveCount(4);
  await page.getByRole('button',{name:'Download .docx',exact:true}).focus();
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  for(let i=0;i<4;i++){
   const canvas=page.locator('canvas.canvas-page').nth(i);await canvas.scrollIntoViewIfNeeded();
   writeFileSync(info.outputPath(c.name+'-'+i+'.png'),Buffer.from(await canvas.evaluate(c=>c.toDataURL().split(',')[1]),'base64'));
   const native=c.pages[i];
   const bounds=await canvas.evaluate((c,size)=>{
    const scale=c.width/size[0],ctx=c.getContext('2d'),{data,width,height}=ctx.getImageData(0,0,c.width,c.height);let left=width,right=0,top=height;
    for(let y=5;y<height-5;y++)for(let x=5;x<width-5;x++){const j=(y*width+x)*4;if(data[j]<160&&data[j+1]<160&&data[j+2]<160){left=Math.min(left,x);right=Math.max(right,x+1);top=Math.min(top,y);}}
    return {left:left/scale,right:right/scale,top:top/scale,ratio:c.height/c.width};
   },native.size);
   expect(bounds.ratio).toBeCloseTo(native.size[1]/native.size[0],2);
   for(const edge of ['left','right','top'])expect(Math.abs(bounds[edge]-native[edge]),c.name+' '+i+' '+edge).toBeLessThan(1.2);
  }
  const save=async label=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(c.name+'-'+label+'.docx');await(await pending).saveAs(path);return path;};
  const parts=unzipSync(readFileSync(folder+c.name+'.docx'));expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
  const original=await input.inputValue();await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');
  const edited=await save('edited');expect(unzipSync(readFileSync(edited))['word/settings.xml']).toEqual(parts['word/settings.xml']);
  await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);
  await reopenDocx(page,input,edited,'Edited '+original);await expect(input).toHaveJSProperty('readOnly',false);
 }
 expect(errors).toEqual([]);
});

test('booklet page setup and ruler edits preserve the saved margin mapping',async({page},info)=>{
 test.setTimeout(120000);
 await page.goto('/playground.html');const source=folder+'small-gutter.docx';await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^Page 1 left edge/);
 await page.getByRole('slider',{name:'Left margin',exact:true}).dblclick();
 await expect(page.getByText('Booklet printing is preserved.',{exact:false})).toBeVisible();
 await page.getByRole('button',{name:'Apply',exact:true}).click();await expect(page.getByRole('button',{name:'Undo',exact:true})).toBeDisabled();
 await page.locator('canvas.canvas-page').first().scrollIntoViewIfNeeded();
 const left=page.getByRole('slider',{name:'Left margin',exact:true});await expect(left).toHaveAttribute('aria-valuenow','1080');
 await left.press('ArrowRight');await expect(left).toHaveAttribute('aria-valuenow','1170');
 await page.getByRole('slider',{name:'Left margin',exact:true}).dblclick();
 await expect(page.getByRole('spinbutton',{name:'Left margin (in)'})).toHaveValue('1');
 await expect(page.getByRole('spinbutton',{name:'Right margin (in)'})).toHaveValue('0.8125');
 await page.getByRole('button',{name:'Cancel',exact:true}).click();
 const save=async name=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await pending).saveAs(path);return path;};
 const edited=await save('ruler-edited'),parts=unzipSync(readFileSync(source));expect(unzipSync(readFileSync(edited))['word/settings.xml']).toEqual(parts['word/settings.xml']);
 await page.getByRole('button',{name:'Undo',exact:true}).click();expect(unzipSync(readFileSync(await save('ruler-undo')))).toEqual(parts);
 await reopenDocx(page,input,edited,await input.inputValue());await expect(input).toHaveJSProperty('readOnly',false);
});
