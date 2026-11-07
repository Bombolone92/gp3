import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
const source='public/fixtures/picture-outlines.docx';
const reference=JSON.parse(readFileSync('tests/fixtures/picture-outlines/reference.json','utf8'));
test.use({deviceScaleFactor:3});
test('matches native picture-outlines ink and preserves shape markup through edit, reopen and undo',async({page},info)=>{
 test.setTimeout(120000);
 expect(createHash('sha256').update(readFileSync(source)).digest('hex')).toBe(reference.sourceSha256);
 expect(createHash('sha256').update(readFileSync('tests/fixtures/picture-outlines/native.pdf')).digest('hex')).toBe(reference.pdfSha256);
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^Picture geometry controls/,{timeout:45000});await expect(input).toHaveJSProperty('readOnly',false);
 const check=async()=>{
  await expect(page.locator('#playground-error')).toBeEmpty();await expect(page.locator('canvas.canvas-page')).toHaveCount(1);
  const colors=await page.evaluate(samples=>{
   const canvas=document.querySelector('canvas.canvas-page'),ctx=canvas.getContext('2d'),scale=canvas.width/612;
   return samples.map(({x,y})=>Array.from(ctx.getImageData(Math.round(x*scale),Math.round(y*scale),1,1).data).slice(0,3));
  },reference.samples);
  for(const [i,sample] of reference.samples.entries()) {
   // Picture-alpha permits three RGB levels per composited layer. This control
   // includes two overlapping translucent paths; opaque samples remain exact.
   if(sample.case===12) for(let c=0;c<3;c++) expect(Math.abs(colors[i][c]-sample.color[c]),`sample ${i}, channel ${c}`).toBeLessThanOrEqual(6);
   else expect(colors[i],`sample ${i}`).toEqual(sample.color);
  }
  const bounds=await page.evaluate(refs=>{
    const canvas=document.querySelector('canvas.canvas-page'),ctx=canvas.getContext('2d'),scale=canvas.width/612;
    return refs.map((_,i)=>{
      const x0=Math.round((60+260*(i%2)-8)*scale), y0=Math.round((90+108*Math.floor(i/2)-8)*scale),w=Math.round(160*scale),h=Math.round(88*scale);
      const pixels=ctx.getImageData(x0,y0,w,h).data;let left=w,top=h,right=-1,bottom=-1;
      for(let y=0;y<h;y++)for(let x=0;x<w;x++){const k=(y*w+x)*4;if(pixels[k]===192&&pixels[k+1]===32&&pixels[k+2]===208){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y);}}
      return {left:(x0+left)/scale,top:(y0+top)/scale,right:(x0+right+1)/scale,bottom:(y0+bottom+1)/scale};
    });
  },reference.outlines);
  for(const [i,actual] of bounds.entries())for(const side of ['left','top','right','bottom'])expect(Math.abs(actual[side]-reference.outlines[i][side]),`outline ${i+1} ${side}`).toBeLessThanOrEqual(.6);

 };
 await check();writeFileSync(info.outputPath('picture-outlines.png'),Buffer.from(await page.locator('canvas.canvas-page').evaluate(c=>c.toDataURL().split(',')[1]),'base64'));
 const original=await input.inputValue();await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');await check();
 const save=async suffix=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(`picture-outlines${suffix}.docx`);await(await pending).saveAs(path);return path;};
 const edited=await save('-edited');await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);await check();
 const a=unzipSync(readFileSync(source)),b=unzipSync(readFileSync(await save('-undo')));for(const name of Object.keys(a))expect(Buffer.from(a[name]).equals(Buffer.from(b[name])),name).toBe(true);
 const savedXml=new TextDecoder().decode(unzipSync(readFileSync(edited))['word/document.xml']);
 const sourceXml=new TextDecoder().decode(unzipSync(readFileSync(source))['word/document.xml']);
 const groups=xml=>xml.match(/<(?:[\w]+:)?pic\b[\s\S]*?<\/(?:[\w]+:)?pic>/g);
 expect(groups(sourceXml)).toHaveLength(12);expect(groups(savedXml)).toEqual(groups(sourceXml));
 const previous=await input.elementHandle();page.once('dialog',d=>d.accept());await page.getByLabel('Open DOCX file').setInputFiles(edited);
 await expect.poll(()=>previous.evaluate(el=>el.isConnected),{timeout:45000}).toBe(false);await previous.dispose();
 await expect(input).toHaveValue('Edited '+original);await expect(input).toHaveJSProperty('readOnly',false);await check();
});
