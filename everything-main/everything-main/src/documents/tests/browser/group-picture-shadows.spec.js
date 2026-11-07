import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
const folder='tests/fixtures/group-picture-shadows',source=`${folder}/control.docx`;
const ref=JSON.parse(readFileSync(`${folder}/reference.json`));
test.use({deviceScaleFactor:3});
test('matches native grouped picture shadows through edit, package preservation, undo and reopen',async({page},info)=>{
 test.setTimeout(180000);
 const bytes=readFileSync(source),parts=unzipSync(bytes);
 expect(createHash('sha256').update(bytes).digest('hex')).toBe(ref.sourceSha256);
 expect(createHash('sha256').update(readFileSync(`${folder}/native.pdf`)).digest('hex')).toBe(ref.pdfSha256);
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});
 await expect(input).toHaveValue(/^no-shadow/);await expect(input).toHaveJSProperty('readOnly',false);
 const check=async()=>{
  await expect(page.locator('canvas.canvas-page')).toHaveCount(ref.pages.length);await expect(page.locator('#playground-error')).toBeEmpty();
  const errors=await page.locator('canvas.canvas-page').evaluateAll((cs,pages)=>cs.flatMap((c,i)=>{
   const ctx=c.getContext('2d'),scale=c.width/612;
   return pages[i].samples.flatMap(s=>{
    const rgb=[...ctx.getImageData(Math.round(s.x*scale),Math.round(s.y*scale),1,1).data].slice(0,3);
    const error=Math.max(...rgb.map((v,j)=>Math.abs(v-s.rgb[j])));
    return error>6?[{page:i+1,name:pages[i].name,...s,actual:rgb,error}]:[];
   });
  }),ref.pages);
  const bounds=await page.locator('canvas.canvas-page').evaluateAll(cs=>cs.map(c=>{
   const ctx=c.getContext('2d'),scale=c.width/612,x0=Math.round(80*scale),y0=Math.round(110*scale),w=Math.round(260*scale),h=Math.round(200*scale),data=ctx.getImageData(x0,y0,w,h).data;
   let l=w,t=h,r=0,b=0;
   for(let y=0;y<h;y++)for(let x=0;x<w;x++){const n=4*(y*w+x);if(Math.min(data[n],data[n+1],data[n+2])<230){l=Math.min(l,x);t=Math.min(t,y);r=Math.max(r,x+1);b=Math.max(b,y+1);}}
   return [(x0+l)/scale,(y0+t)/scale,(x0+r)/scale,(y0+b)/scale];
  }));
  ref.pages.forEach((p,i)=>p.bounds.forEach((v,k)=>expect(Math.abs(v-bounds[i][k]),p.name+' boundary '+k).toBeLessThan(1)));
  writeFileSync(info.outputPath('differences.json'),JSON.stringify(errors,null,2));
  expect(errors.slice(0,20)).toEqual([]);
 };
 await check();
 for(const [i,data] of (await page.locator('canvas.canvas-page').evaluateAll(cs=>cs.map(c=>c.toDataURL()))).entries())writeFileSync(info.outputPath(`page${i+1}.png`),Buffer.from(data.split(',')[1],'base64'));
 const save=async name=>{const event=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await event).saveAs(path);return path;};
 expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
 const original=await input.inputValue();await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');await check();
 const edited=await save('edited'),after=unzipSync(readFileSync(edited));
 const shapes=b=>new TextDecoder().decode(b).match(/<pic:pic\b[\s\S]*?<\/pic:pic>/g);
 expect(shapes(after['word/document.xml'])).toEqual(shapes(parts['word/document.xml']));
 for(const [name,data] of Object.entries(parts))if(name!=='word/document.xml')expect(after[name]).toEqual(data);
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);await check();
 await reopenDocx(page,input,edited,'Edited '+original);await expect(input).toHaveJSProperty('readOnly',false);await check();
});
