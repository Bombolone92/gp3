import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
const reference=JSON.parse(readFileSync('tests/fixtures/solid-fill-display/reference.json','utf8'));
for(const native of reference.observations)test(`${native.control} opaque thin fills match native screen profiles through print, edit and undo`,async({page},info)=>{
 test.setTimeout(120000);
 const source=`tests/fixtures/solid-fill-display/${native.control}.docx`,bytes=readFileSync(source),parts=unzipSync(bytes);
 expect(createHash('sha256').update(bytes).digest('hex')).toBe(native.sourceSha256);
 await page.goto('/playground.html');
 await page.evaluate(async()=>{
  const {CanvasEditor}=await import('/tools/reviewed-family-modules.js'),relayout=CanvasEditor.prototype.relayout;
  CanvasEditor.prototype.relayout=function(...args){const result=relayout.apply(this,args);window.solidFillEditor=this;return result;};
 });
 await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(native.control.startsWith('group-')?'\ufffc':Array(16).fill('\ufffc').join('\n'));
 await expect(input).toHaveJSProperty('readOnly',false);await expect(page.locator('canvas.canvas-page')).toHaveCount(1);
 const verify=async()=>{
  const actual=await page.evaluate(profiles=>{
   const e=window.solidFillEditor,c=e.canvases[0],ctx=c.getContext('2d');
   return profiles.map(p=>({index:p.index,coordinates:p.offsets.filter(d=>ctx.getImageData(p.axis==='y'?p.fixed:p.start+d,p.axis==='y'?p.start+d:p.fixed,1,1).data[0]<190).map(d=>p.start+d)}));
  },native.profiles);
  for(const [i,row]of actual.entries())expect(row.coordinates,`native fill ${row.index}`).toEqual(native.profiles[i].nativeInkCoordinates);
 };
 await verify();
 const print=await page.evaluate(async()=>{
  const e=window.solidFillEditor,sheet=e.printSheets()[0],data=sheet.getContext('2d').getImageData(0,0,sheet.width,sheet.height).data;
  const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',data))].map(b=>b.toString(16).padStart(2,'0')).join('');e.paint();return digest;
 });
 expect(print).toBe(native.baselinePrintRgbaSha256);await verify();
 const save=async name=>{
  const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();
  const output=info.outputPath(name+'.docx');await(await pending).saveAs(output);return output;
 };
 expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
 const original=await input.inputValue();await input.focus();await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');
 const edited=await save('edited'),changed=unzipSync(readFileSync(edited));
 for(const key of Object.keys(parts))if(key!=='word/document.xml')expect(changed[key],key).toEqual(parts[key]);
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);await verify();
 expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);
 await reopenDocx(page,input,edited,'Edited '+original);await expect(input).toHaveJSProperty('readOnly',false);
 await expect(page.locator('canvas.canvas-page')).toHaveCount(1);await expect(page.locator('#playground-error')).toBeEmpty();
});

test('opaque rectangle screen painting preserves clipping and caller state and retains affine/opacity fallbacks',async({page})=>{
 await page.goto('/playground.html');
 const result=await page.evaluate(async()=>{
  const {decodeShape}=await import('/src/engine/canvas-shapes.js');
  const asset={width:.5,height:24,scene:{type:'shape',width:4762.5,height:228600,fill:'#669748',paths:[{fill:true,width:1,height:1,points:[['M',0,0],['L',1,0],['L',1,1],['L',0,1],['Z']]}]}};
  const image=await decodeShape(asset,new Map()),reserved=image.rasterPixelCount,c=new OffscreenCanvas(20,60),ctx=c.getContext('2d');
  try{
   ctx.fillStyle='#123456';ctx.strokeStyle='#abcdef';ctx.setTransform(2,0,0,2,0,0);
   const clip=new Path2D();clip.rect(0,0,1,24);ctx.clip(clip);
   const state=()=>JSON.stringify([ctx.getTransform(),ctx.fillStyle,ctx.strokeStyle,ctx.globalAlpha,ctx.globalCompositeOperation]);
   const before=state(),painted=image.paintDisplay(ctx,.75,0,.5,24,{bitmapDisplayScale:2}),sameState=state()===before;
   const data=ctx.getImageData(0,0,20,60).data,ink=[];for(let x=0;x<20;x++)if(data[4*(10*20+x)+3])ink.push(x);
   ctx.globalAlpha=.5;const opacityFallback=!image.paintDisplay(ctx,0,0,.5,24,{bitmapDisplayScale:2});ctx.globalAlpha=1;
   ctx.translate(1,0);const translatedFallback=!image.paintDisplay(ctx,0,0,.5,24,{bitmapDisplayScale:2});
   ctx.setTransform(0,2,-2,0,10,0);const rotatedFallback=!image.paintDisplay(ctx,0,0,.5,24,{bitmapDisplayScale:2});
   ctx.resetTransform();const printFallback=!image.paintDisplay(ctx,0,0,.5,24,{});
   const raster=image.forPage(undefined,{x:0,y:0,width:.5,height:24,pixelRatio:1,axisAligned:true});
   const bitmap=raster.bitmap;image.close();
   return {painted,sameState,ink,opacityFallback,translatedFallback,rotatedFallback,printFallback,reserved:reserved>0,released:bitmap.width===0};
  }finally{image.close();}
 });
 expect(result).toEqual({painted:true,sameState:true,ink:[],opacityFallback:true,translatedFallback:true,rotatedFallback:true,printFallback:true,reserved:true,released:true});
});

test('a filled group remains renderable when device padding exceeds its existing raster budget',async({page})=>{
 await page.goto('/playground.html');
 const result=await page.evaluate(async()=>{
  const {decodeShape}=await import('/src/engine/canvas-shapes.js'),unit=9525;
  const rectangle={type:'shape',x:0,y:0,width:unit/2,height:24*unit,fill:'#669748',paths:[{fill:true,width:1,height:1,points:[['M',0,0],['L',1,0],['L',1,1],['L',0,1],['Z']]}]};
  const asset={width:100,height:50,scene:{type:'group',x:0,y:0,width:100*unit,height:50*unit,childX:0,childY:0,childWidth:100*unit,childHeight:50*unit,children:[rectangle,{...rectangle,x:20*unit}]}},unchanged=JSON.stringify(asset);
  let reserved,calls=0,rejected=[];
  const image=await decodeShape(asset,new Map(),undefined,(_,next)=>{
   calls++;if((next.rasterPixelCount??next.bitmap.width*next.bitmap.height)>reserved){rejected.push(next.bitmap);throw Error('Existing raster budget');}
  });reserved=image.rasterPixelCount;
  try{
   const placement={x:.25,y:.5,width:100,height:50,pixelRatio:1,axisAligned:true},context={bitmapDisplayScale:1};
   const first=image.forPage(context,placement),firstCount=calls,reused=image.forPage(context,placement)===first;
   const noRepeatedAllocation=calls===firstCount;
   const moved=image.forPage(context,{...placement,x:.5}),priorReleased=first.bitmap.width===0;
   const withinBudget=moved.bitmap.width*moved.bitmap.height<=reserved;
   const finalBitmap=moved.bitmap;image.close();
   return {reused,noRepeatedAllocation,withinBudget,priorReleased,rejectedReleased:rejected.length===2&&rejected.every(b=>b.width===0),finalReleased:finalBitmap.width===0,unchanged:JSON.stringify(asset)===unchanged};
  }finally{image.close();}
 });
 expect(result).toEqual({reused:true,noRepeatedAllocation:true,withinBudget:true,priorReleased:true,rejectedReleased:true,finalReleased:true,unchanged:true});
});
