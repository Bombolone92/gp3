import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
const root='tests/fixtures/oversized-body-lines/',refs=JSON.parse(readFileSync(root+'reference.json')).records;
test.use({deviceScaleFactor:1.5});
for(const name of ['inline-fresh','inline-preceded','inline-beyond-page','inline-consecutive'])test(`tall inline drawings retain native bounds through editing: ${name}`,async({page},info)=>{
 test.setTimeout(120000);const source=root+name+'.docx',bytes=readFileSync(source),parts=unzipSync(bytes),ref=refs[name],errors=[];
 for(const[file,hash]of [[source,ref.sourceSha256],[root+name+'-native.pdf',ref.pdfSha256]])expect(createHash('sha256').update(readFileSync(file)).digest('hex')).toBe(hash);
 page.on('pageerror',e=>errors.push(e.message));await page.goto('/playground.html');const input=page.getByRole('textbox',{name:'Document text'}),old=await input.elementHandle();await page.getByLabel('Open DOCX file').setInputFiles(source);await page.waitForFunction(el=>!el.isConnected,old);await old.dispose();
 const check=async()=>{
  await expect(input).toBeEditable();await expect(page.locator('canvas.canvas-page')).toHaveCount(ref.pages.length);await expect(page.locator('#playground-error')).toBeEmpty();
  for(const[i,native]of ref.pages.entries())if(native.pictures.length){
   const actual=await page.locator('canvas.canvas-page').nth(i).evaluate(c=>{const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let l=c.width,t=c.height,r=-1,b=-1;for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++){const k=(y*c.width+x)*4;if((d[k]<100&&d[k+1]<160&&d[k+2]>120)||(d[k]>180&&d[k+1]>50&&d[k+1]<160&&d[k+2]<100)){l=Math.min(l,x);t=Math.min(t,y);r=Math.max(r,x);b=Math.max(b,y);}}return[l,t,r+1,b+1].map(v=>v*612/c.width);});
   for(let k=0;k<4;k++)expect(Math.abs(actual[k]-native.visiblePictureBounds[k]),`page ${i+1}, bound ${k}`).toBeLessThanOrEqual(.5);
  }
 };
 const save=async label=>{const event=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(label+'.docx');await(await event).saveAs(path);return path;};
 await check();expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);const original=await input.inputValue();await input.focus();await input.press('ControlOrMeta+End');await page.keyboard.insertText(' edited');await expect(input).toHaveValue(original+' edited');await check();
 const edited=await save('edited'),out=unzipSync(readFileSync(edited));for(const[n,b]of Object.entries(parts))if(n!=='word/document.xml')expect(out[n],n).toEqual(b);
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);await reopenDocx(page,input,edited,original+' edited');await check();expect(errors).toEqual([]);
});
