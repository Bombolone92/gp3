import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
const root='tests/fixtures/border-preview/',ref=JSON.parse(readFileSync(root+'reference.json'));
test('preserves native geometry and columns while keeping unsupported borders read-only',async({page},info)=>{
 // The private Vite server cold-transforms the engine before opening a DOCX.
 // Keep the native pixel bounds and per-action assertions unchanged.
 test.setTimeout(180000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/playground.html',{waitUntil:'domcontentloaded',timeout:90000});
 await page.getByLabel('Open DOCX file').setInputFiles(root+'control.docx');
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^S0 P0/);await expect(input).toHaveJSProperty('readOnly',true);
 await expect(page.locator('canvas.canvas-page')).toHaveCount(2);
 const check=async()=>{
  for(const[i,r]of ref.pages.entries()){
   const png=readFileSync(root+r.image);expect(createHash('sha256').update(png).digest('hex')).toBe(r.sha256);
   const result=await page.locator('canvas.canvas-page').nth(i).evaluate(async(canvas,{r,uri})=>{
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const image=new Image();image.src=uri;await image.decode();const c=document.createElement('canvas');c.width=r.width;c.height=r.height;const ctx=c.getContext('2d');
    ctx.drawImage(image,0,0);const native=ctx.getImageData(0,0,c.width,c.height).data;
    ctx.clearRect(0,0,c.width,c.height);ctx.drawImage(canvas,0,0,c.width,c.height);const actual=ctx.getImageData(0,0,c.width,c.height).data;
    let count=0,mismatch=0;
    // Blue art is excluded. Bidirectional black-glyph masks check every text
    // line against the native reference, allowing one pixel for rasterizer differences.
    for(let y=1;y<c.height-1;y++)for(let x=1;x<c.width-1;x++)for(const[a,b]of[[native,actual],[actual,native]]){
     const k=(y*c.width+x)*4;if(Math.max(a[k],a[k+1],a[k+2])>=128)continue;count++;let match=false;
     for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const j=((y+dy)*c.width+x+dx)*4;if(Math.max(b[j],b[j+1],b[j+2])<128)match=true;}
     if(!match)mismatch++;
    }
    return {width:parseFloat(canvas.style.width),height:parseFloat(canvas.style.height),count,mismatch};
   },{r,uri:'data:image/png;base64,'+png.toString('base64')});
   expect(result.width).toBe(r.width);expect(result.height).toBe(r.height);expect(result.count).toBeGreaterThan(1000);expect(result.mismatch/result.count,JSON.stringify(result)).toBeLessThan(.005);
  }
 };
 await check();const text=await input.inputValue();await input.focus();await page.keyboard.insertText('Forbidden edit');await expect(input).toHaveValue(text);
 const wait=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath('original.docx');await(await wait).saveAs(path);
 const original=unzipSync(readFileSync(root+'control.docx')),out=unzipSync(readFileSync(path));expect(Object.keys(out).sort()).toEqual(Object.keys(original).sort());for(const[n,b]of Object.entries(original))expect(Buffer.from(out[n]).equals(Buffer.from(b)),n).toBe(true);
 await page.getByLabel('Open DOCX file').setInputFiles(path);await expect(input).toHaveJSProperty('readOnly',true);await check();expect(errors).toEqual([]);
});
