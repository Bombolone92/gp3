import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';
const isolation=JSON.parse(readFileSync('tests/fixtures/measurements/outline-asset-isolation.json'));
const fills=JSON.parse(readFileSync('tests/fixtures/measurements/outline-fill-placement.json'));
const groups=[['outline-stroke-holdouts',['rotation-alpha','dash-compound','alpha-only']],['outline-curve-display',['control','phase-boundaries']],['outline-fill-holdouts',['combined','group']]];
for(const [group,names] of groups)for(const name of names)test(`native display geometry and editable retention: ${group}/${name}`,async({page},info)=>{
  test.setTimeout(180000);
  const folder=`tests/fixtures/${group}/`,reference=JSON.parse(readFileSync(folder+'reference.json'));
  const observations=reference.observations.filter(o=>o.fixture===name);
  await page.goto('/playground.html');
  const old=await page.getByRole('textbox',{name:'Document text'}).elementHandle();
  await page.getByLabel('Open DOCX file').setInputFiles(folder+name+'.docx');
  await expect.poll(()=>old.evaluate(el=>el.isConnected),{timeout:45000}).toBe(false);
  const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveJSProperty('readOnly',false);
  await expect(page.locator('canvas.canvas-page')).toHaveCount(1);
  for(const observation of observations){
    await page.getByRole('combobox',{name:'Zoom'}).selectOption(String(observation.zoom/100));
    const metrics=group==='outline-fill-holdouts'
      ? fills.comparisons.find(c=>c.fixture===name&&c.zoom===observation.zoom&&c.mode==='fillStroke').regions
      : isolation.comparisons.find(c=>c.group===group&&c.fixture===name&&c.zoom===observation.zoom).regions;
    let regions=observation.regions;
    if(!regions){
      const cases=JSON.parse(readFileSync(folder+(name==='control'?'cases.json':'phase-boundaries-cases.json'))),scale=observation.zoom/100;
      regions=cases.map(c=>[Math.floor(c.xEmu/9525*scale)-3,Math.floor(c.yEmu/9525*scale)-3,Math.round(64*scale)+7,Math.round(40*scale)+7]);
    }
    const errors=await page.evaluate(async({bytes,regions})=>{
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const bitmap=await createImageBitmap(new Blob([new Uint8Array(bytes)],{type:'image/png'}));
      const reference=new OffscreenCanvas(bitmap.width,bitmap.height),ctx=reference.getContext('2d');ctx.drawImage(bitmap,0,0);bitmap.close();
      const actual=document.querySelector('canvas.canvas-page').getContext('2d');
      return regions.map(([x,y,w,h])=>{
        const a=actual.getImageData(x,y,w,h).data,b=ctx.getImageData(x,y,w,h).data;let sum=0;
        for(let i=0;i<a.length;i+=4)for(let c=0;c<3;c++)sum+=Math.abs(a[i+c]-b[i+c]);return sum/(w*h*3);
      });
    },{bytes:[...readFileSync(folder+observation.crop)],regions});
    for(let i=0;i<errors.length;i++)expect(errors[i],`${name} ${observation.zoom}% case ${i+1}`).toBeLessThanOrEqual(metrics[i].candidateMAE+1e-8);
    writeFileSync(info.outputPath(`page-${observation.zoom}.png`),Buffer.from(await page.locator('canvas.canvas-page').evaluate(c=>c.toDataURL().split(',')[1]),'base64'));
  }
  const original=await input.inputValue(),parts=unzipSync(readFileSync(folder+name+'.docx'));
  const save=async label=>{const event=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(label+'.docx');await(await event).saveAs(path);return path;};
  expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
  await input.focus();await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');
  const edited=await save('edited');
  const changed=unzipSync(readFileSync(edited));for(const part of Object.keys(parts))if(part!=='word/document.xml')expect(changed[part],part).toEqual(parts[part]);
  await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);
  await reopenDocx(page,input,edited,'Edited '+original,{timeout:45000});
});

test('display raster defers paint, reuses device phase and falls back within reserved resources',async({page})=>{
  test.setTimeout(180000);await page.goto('/playground.html');
  const result=await page.evaluate(async()=>{
    const {decodeShape}=await import('/src/engine/canvas-shapes.js');
    const scene={type:'shape',x:0,y:0,width:952500,height:476250,outline:{width:4327,color:'#C0C0C0'},fill:'#D5D5D5',paths:[{width:1,height:1,fill:true,stroke:true,points:[['M',0,0],['L',1,0],['L',1,1],['L',0,1],['Z']]}]};
    const asset={width:100,height:50,scene};let paints=0;
    const original=OffscreenCanvas.prototype.transferToImageBitmap;
    OffscreenCanvas.prototype.transferToImageBitmap=function(){paints++;return original.call(this);};
    try{
      const image=await decodeShape(asset,new Map()),reserved=image.rasterPixelCount;
      const initialPaints=paints,placement={x:.25,y:.5,width:100,height:50,pixelRatio:1};
      const first=image.forPage(null,placement),firstPaints=paints;
      const moved=image.forPage(null,{...placement,x:20.25,y:30.5}),reused=first.bitmap===moved.bitmap;
      const phase=image.forPage(null,{...placement,x:.5}),phasePaints=paints,closedOld=first.bitmap.width===0;
      image.close();const closedLast=phase.bitmap.width===0;
      let callbacks=0;
      const fallback=await decodeShape(asset,new Map(),undefined,()=>{if(++callbacks===1)throw Error('Simulated preview budget');});
      const fallbackView=fallback.forPage(null,{...placement,pixelRatio:1.25});
      const fallbackPixels=fallbackView.bitmap.width*fallbackView.bitmap.height;fallback.close();
      return {initialPaints,firstPaints,phasePaints,reused,closedOld,closedLast,callbacks,fallbackPixels,reserved};
    }finally{OffscreenCanvas.prototype.transferToImageBitmap=original;}
  });
  expect(result.initialPaints).toBe(0);expect(result.firstPaints).toBe(1);expect(result.phasePaints).toBe(2);
  expect(result.reused).toBe(true);expect(result.closedOld).toBe(true);expect(result.closedLast).toBe(true);
  expect(result.callbacks).toBe(2);expect(result.fallbackPixels).toBe(result.reserved);
});
