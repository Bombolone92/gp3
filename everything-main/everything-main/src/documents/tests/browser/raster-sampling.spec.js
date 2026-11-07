import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';
import { expectBodyEditParts } from './helpers/expect-body-edit-parts.js';
const source='public/fixtures/raster-sampling.docx';
const reference=JSON.parse(readFileSync('tests/fixtures/raster-sampling/reference.json'));

test('downsamples inline, cropped, grouped and shape-filled pictures against the native reference',async({page},info)=>{
  for(const [path,hash] of Object.entries(reference.hashes))expect(createHash('sha256').update(readFileSync(path)).digest('hex')).toBe(hash);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
  const input=page.getByRole('textbox',{name:'Document text'});
  await expect(input).toHaveValue(/^Raster sampling controls/);await expect(input).not.toHaveAttribute('readonly','');
  await expect(page.locator('canvas.canvas-page')).toHaveCount(1);
  const sample=async()=>page.locator('canvas.canvas-page').evaluate((c,cases)=>cases.map(({box})=>{
    const [x,y,r,b]=box,bytes=c.getContext('2d').getImageData(x,y,r-x,b-y).data;
    let sum=0,square=0;for(let i=0;i<bytes.length;i+=4){sum+=bytes[i];square+=bytes[i]**2;}
    const n=bytes.length/4,mean=sum/n;return {mean,stddev:Math.sqrt(Math.max(0,square/n-mean**2))};
  }),reference.cases);
  const initial=await sample();
  for(const [i,expected] of reference.cases.entries()){
    expect(Math.abs(initial[i].mean-expected.mean),expected.name).toBeLessThan(3);
    expect(initial[i].stddev,expected.name).toBeLessThan(expected.stddev+2);
  }
  const original=unzipSync(readFileSync(source));
  const download=async name=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name);await(await pending).saveAs(path);return path;};
  const same=(path,edited=false)=>{const parts=unzipSync(readFileSync(path));expect(Object.keys(parts).sort()).toEqual(Object.keys(original).sort());if(edited)expectBodyEditParts(parts,original);else for(const n of Object.keys(original))expect(Buffer.from(parts[n]).equals(Buffer.from(original[n])),n).toBe(true);};
  same(await download('noedit.docx'));
  const text=await input.inputValue();await input.focus();await input.press('ControlOrMeta+End');await page.keyboard.insertText(' verified');
  const editedText=await input.inputValue(),edited=await download('edited.docx');same(edited,true);
  await input.press('ControlOrMeta+z');await expect(input).toHaveValue(text);same(await download('undo.docx'));
  expect(await sample()).toEqual(initial);await reopenDocx(page,input,edited,editedText);expect(await sample()).toEqual(initial);
  expect(errors).toEqual([]);
});
test('reuses immutable samples and refreshes crop and device-density changes',async({page})=>{
  await page.goto('/playground.html');
  const result=await page.evaluate(async()=>{
    const {paintImage}=await import('/src/engine/paint-image.js');
    const source=new OffscreenCanvas(1000,500),s=source.getContext('2d');s.fillStyle='red';s.fillRect(0,0,500,500);s.fillStyle='blue';s.fillRect(500,0,500,500);
    const bitmap=await createImageBitmap(source),canvas=new OffscreenCanvas(500,300),ctx=canvas.getContext('2d');
    const native=OffscreenCanvasRenderingContext2D.prototype.drawImage;let sourceDraws=0;
    OffscreenCanvasRenderingContext2D.prototype.drawImage=function(image,...args){if(image===bitmap)sourceDraws++;return native.call(this,image,...args);};
    try{
      for(let i=0;i<12;i++)paintImage(ctx,bitmap,0,0,100,50);
      const repeated=sourceDraws;
      paintImage(ctx,bitmap,500,0,500,500,0,0,50,50);const cropped=sourceDraws;
      const color=Array.from(ctx.getImageData(20,20,1,1).data);
      paintImage(ctx,bitmap,0,0,100,50);const reusedOriginal=sourceDraws;
      ctx.scale(2,2);paintImage(ctx,bitmap,500,0,500,500,0,0,50,50);const density=sourceDraws;
      bitmap.close();let closedThrows=false;try{paintImage(ctx,bitmap,0,0,100,50);}catch{closedThrows=true;}
      return {repeated,cropped,density,reusedOriginal,color,closedThrows};
    }finally{OffscreenCanvasRenderingContext2D.prototype.drawImage=native;bitmap.close();}
  });
  expect(result).toEqual({repeated:1,cropped:2,density:3,reusedOriginal:2,color:[0,0,255,255],closedThrows:true});
});
test('bounds retained samples and never caches mutable canvas pixels',async({page})=>{
  await page.goto('/playground.html');
  const result=await page.evaluate(async()=>{
    const {paintImage}=await import('/src/engine/paint-image.js');
    const source=new OffscreenCanvas(1025,1025),s=source.getContext('2d');s.fillStyle='red';s.fillRect(0,0,1025,1025);
    const canvas=new OffscreenCanvas(512,512),ctx=canvas.getContext('2d'),bitmaps=[];
    for(let i=0;i<17;i++)bitmaps.push(await createImageBitmap(source));
    const original=ImageBitmap.prototype.close;let evictions=0;
    ImageBitmap.prototype.close=function(){if(!bitmaps.includes(this))evictions++;return original.call(this);};
    try{
      for(const bitmap of bitmaps)paintImage(ctx,bitmap,0,0,512,512);
      const full=evictions;paintImage(ctx,bitmaps[0],0,0,512,512);const revisit=evictions;
      paintImage(ctx,source,0,0,100,100);const first=Array.from(ctx.getImageData(20,20,1,1).data);
      s.fillStyle='blue';s.fillRect(0,0,1025,1025);paintImage(ctx,source,0,0,100,100);
      return {full,revisit,first,changed:Array.from(ctx.getImageData(20,20,1,1).data)};
    }finally{ImageBitmap.prototype.close=original;for(const bitmap of bitmaps)bitmap.close();}
  });
  expect(result).toEqual({full:1,revisit:2,first:[255,0,0,255],changed:[0,0,255,255]});
});
test('retains direct sampling sharpness at fractional, rotated and reflected positions',async({page})=>{
  await page.goto('/playground.html');
  const errors=await page.evaluate(async()=>{
    const {paintImage}=await import('/src/engine/paint-image.js');
    const source=new OffscreenCanvas(1000,500),s=source.getContext('2d');s.fillStyle='#207880';s.fillRect(0,0,1000,500);s.strokeStyle='white';s.lineWidth=8;s.beginPath();s.moveTo(50,440);s.quadraticCurveTo(400,70,950,100);s.stroke();
    const bitmap=await createImageBitmap(source),errors=[];
    try{for(const angle of [0,.41])for(const flip of [1,-1])for(const phase of [.1,.7])for(const alpha of [1,.7]){
      const canvases=[new OffscreenCanvas(300,220),new OffscreenCanvas(300,220)];
      for(const [i,c] of canvases.entries()){
        const ctx=c.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,c.width,c.height);ctx.translate(150+phase,80+phase);ctx.rotate(angle);ctx.scale(flip,1);ctx.globalAlpha=alpha;ctx.beginPath();ctx.rect(-5,-5,108,65);ctx.clip();
        if(i===0){ctx.imageSmoothingQuality='high';ctx.drawImage(bitmap,10,0,980,500,0,0,111,55.5);}
        else paintImage(ctx,bitmap,10,0,980,500,0,0,111,55.5);
      }
      const [a,b]=canvases.map(c=>c.getContext('2d').getImageData(0,0,c.width,c.height).data);let bad=0,sum=0,max=0;
      for(let i=0;i<a.length;i++){const d=Math.abs(a[i]-b[i]);sum+=d;max=Math.max(max,d);if(d>2)bad++;}
      errors.push({angle,flip,phase,alpha,bad,max,mean:sum/a.length});
    }}finally{bitmap.close();}return errors;
  });
  // The extra premultiplied-alpha composition can round channels by two levels.
  // Any larger change, including a blurred edge, must fail.
  for(const e of errors)expect(e.bad,JSON.stringify(e)).toBe(0);
});
