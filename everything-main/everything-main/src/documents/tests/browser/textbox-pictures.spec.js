import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
import {expectBodyEditParts} from './helpers/expect-body-edit-parts.js';
for(const folder of ['textbox-pictures','reflected-textboxes'])test(`matches native inline pictures inside scaled, nested, rotated and clipped text boxes: ${folder}`,async({page},info)=>{
 const root=`tests/fixtures/${folder}/`;
 test.setTimeout(180000);
 const ref=JSON.parse(readFileSync(root+'reference.json')),bytes=readFileSync(root+'control.docx'),errors=[];
 const hash=b=>createHash('sha256').update(b).digest('hex');expect(hash(bytes)).toBe(ref.sourceSha256);
 const native=ref.pages.map(p=>{const b=readFileSync(root+p.name);expect(hash(b)).toBe(p.sha256);return 'data:image/png;base64,'+b.toString('base64');});
 page.on('pageerror',e=>errors.push(e.message));await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(root+'control.docx');
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^Textbox pictures/);await expect(input).toBeEditable();
 const check=async(compareText=false)=>{
  await expect(page.locator('canvas.canvas-page')).toHaveCount(ref.pages.length);await expect(page.locator('#playground-error')).toBeEmpty();
  for(let i=0;i<ref.pages.length;i++){
   const stats=await page.locator('canvas.canvas-page').nth(i).evaluate(async(canvas,{uri,compareText})=>{
    const im=new Image();im.src=uri;await im.decode();const c=document.createElement('canvas');c.width=816;c.height=1056;const ctx=c.getContext('2d');ctx.drawImage(im,0,0);const a=ctx.getImageData(0,0,816,1056).data;ctx.clearRect(0,0,816,1056);ctx.drawImage(canvas,0,0,816,1056);const b=ctx.getImageData(0,0,816,1056).data;
    let count=0,mismatch=0;
    // Compare original picture colors and dark glyph ink in both directions.
    // One pixel and color tolerance accommodate font/edge antialiasing.
    for(let y=70;y<400;y++)for(let x=80;x<500;x++)for(const[src,dst]of[[a,b],[b,a]]){
     const k=(y*816+x)*4,max=Math.max(src[k],src[k+1],src[k+2]),min=Math.min(src[k],src[k+1],src[k+2]),glyph=max-min<90;
     if(glyph&&(!compareText||max>100))continue;count++;let match=false;
     for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const j=((y+dy)*816+x+dx)*4;
      if(glyph ? Math.max(dst[j],dst[j+1],dst[j+2])<180 : Math.max(...[0,1,2].map(v=>Math.abs(src[k+v]-dst[j+v])))<48)match=true;
     }
     if(!match)mismatch++;
    }
    return {count,mismatch};
   },{uri:native[i],compareText});
   expect(stats.count,'page '+(i+1)).toBeGreaterThan(1000);expect(stats.mismatch/stats.count,JSON.stringify({page:i+1,...stats})).toBeLessThan(.01);
  }
 };
 await check(true);
 for(let i=0;i<ref.pages.length;i++)writeFileSync(info.outputPath(`page-${i+1}.png`),Buffer.from(await page.locator('canvas.canvas-page').nth(i).evaluate(c=>c.toDataURL().split(',')[1]),'base64'));
 const original=await input.inputValue(),parts=unzipSync(bytes);
 const save=async name=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await pending).saveAs(path);return path;};
 expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
 await input.focus();await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Added ');await check();
 const edited=await save('edited');expectBodyEditParts(unzipSync(readFileSync(edited)),parts);
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);
 await reopenDocx(page,input,edited,'Added '+original);await check();expect(errors).toEqual([]);
});
