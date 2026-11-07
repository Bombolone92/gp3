import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';
const folder='tests/fixtures/svg-text';
const bytes=readFileSync(`${folder}/svg-text.docx`), ref=JSON.parse(readFileSync(`${folder}/reference.json`,'utf8'));
test('matches native SVG text, font fallback and positioned spans while preserving both image representations',async({page},info)=>{
 test.setTimeout(120000);
 expect(createHash('sha256').update(bytes).digest('hex')).toBe(ref.sourceSha256);
 expect(createHash('sha256').update(readFileSync(`${folder}/native.pdf`)).digest('hex')).toBe(ref.pdfSha256);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/playground.html');
 const actual=await page.evaluate(async ({base64,count})=>{
  const {DocxPackage}=await import('/src/engine/docx.js');const {decodeSvg}=await import('/src/engine/svg-images.js');
  const p=await DocxPackage.open(Uint8Array.from(atob(base64),c=>c.charCodeAt(0))),result=[];
  for(let i=0;i<=count;i++){
   let svg=p.assets[`word/media/text${Math.min(i,count-1)}.svg`].bytes;
   if(i===count) svg=new TextEncoder().encode(new TextDecoder().decode(svg).replace('>A\u00a0B<','><![CDATA[A\u00a0B]]><'));
   const image=await decodeSvg(svg),c=document.createElement('canvas');c.width=1200;c.height=480;
   const ctx=c.getContext('2d');ctx.drawImage(image,0,0,c.width,c.height);image.close();
   const data=ctx.getImageData(0,0,c.width,c.height).data;let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;
   for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++){const at=(y*c.width+x)*4;if(data[at]>160&&data[at+1]<100&&data[at+2]<120){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x+1);bottom=Math.max(bottom,y+1);}}
   result.push({left:left/4,top:top/4,right:right/4,bottom:bottom/4});
  }return result;
 },{base64:bytes.toString('base64'),count:ref.cases.length});
 writeFileSync(info.outputPath('ink.json'),JSON.stringify(actual,null,2));
 for(const [i,b] of actual.entries())for(const key of Object.keys(b))expect(Math.abs(b[key]-ref.cases[Math.min(i,ref.cases.length-1)][key]),`case ${i+1} ${key}`).toBeLessThan(1);
 expect(actual.at(-1)).toEqual(actual.at(-2)); // XML CDATA preserves the same characters and positioning.
 await page.getByLabel('Open DOCX file').setInputFiles(`${folder}/svg-text.docx`);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^SVG text control/);await expect(input).toHaveJSProperty('readOnly',false);
 await expect(page.locator('canvas.canvas-page')).toHaveCount(ref.cases.length);
 const original=await input.inputValue(),parts=unzipSync(bytes);
 const save=async name=>{const next=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(`${name}.docx`);await(await next).saveAs(path);return path;};
 expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
 await input.press('ControlOrMeta+End');await page.keyboard.insertText(' EDIT');const edited=await save('edited'),changed=unzipSync(readFileSync(edited));
 for(const name of Object.keys(parts))if(name!=='word/document.xml')expect(changed[name],name).toEqual(parts[name]);
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);
 await reopenDocx(page,input,edited,original+' EDIT');await expect(page.locator('canvas.canvas-page')).toHaveCount(ref.cases.length);
 await expect(page.locator('#playground-error')).toBeEmpty();expect(errors).toEqual([]);
});
