import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root='tests/fixtures/scaled-picture-shadows/';
test('wide textured shadow matches native metafile playback within one native texel',async({page},info)=>{
 const ref=JSON.parse(readFileSync(root+'metafile/reference.json'));
 for(const [file,hash] of Object.entries(ref.sha256))expect(createHash('sha256').update(readFileSync(root+file)).digest('hex'),file).toBe(hash);
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(root+'source.docx');
 await expect(page.locator('canvas.canvas-page')).toHaveCount(14);
 await expect(page.getByRole('textbox',{name:'Document text'})).toHaveValue(/^align-tl/);
 const result=await page.locator('canvas.canvas-page').nth(13).evaluate(async(c,{ref,png})=>{
  const bitmap=await createImageBitmap(new Blob([Uint8Array.from(atob(png),c=>c.charCodeAt(0))],{type:'image/png'}));
  const native=new OffscreenCanvas(bitmap.width,bitmap.height),ctx=native.getContext('2d');ctx.drawImage(bitmap,0,0);bitmap.close();
  const pixels=ctx.getImageData(0,0,native.width,native.height).data;
  const [sx,,,sy,tx,ty]=ref.images[1].transform, [ax,ay]=ref.anchorPt,r=ref.radiusPixels,scale=c.width/432;
  const actual=c.getContext('2d');
  const samples=ref.points.map(([x,y])=>{
   const rgb=[...actual.getImageData(Math.round(x*scale),Math.round(y*scale),1,1).data].slice(0,3);
   const px=Math.round(tx+(x-ax)*sx),py=Math.round(ty+(y-ay)*sy);let error=255;
   for(let yy=py-r;yy<=py+r;yy++)for(let xx=px-r;xx<=px+r;xx++){
    // The recorded EMF drawing bounds fit entirely inside the expanded image.
    // Outside that image is the same white background, not discarded samples.
    const inside=xx>=0&&yy>=0&&xx<native.width&&yy<native.height,i=(yy*native.width+xx)*4;
    error=Math.min(error,Math.max(...rgb.map((v,k)=>Math.abs(v-(inside?pixels[i+k]:255)))));
   }
   return {x,y,rgb,error};
  });
  return {tested:samples.length,maxError:Math.max(...samples.map(s=>s.error)),failures:samples.filter(s=>s.error>ref.allowance)};
 },{ref,png:readFileSync(root+'metafile/expanded.png').toString('base64')});
 writeFileSync(info.outputPath('native-comparison.json'),JSON.stringify(result,null,2));
 expect(result.tested).toBe(1223);expect(result.failures).toEqual([]);
});
