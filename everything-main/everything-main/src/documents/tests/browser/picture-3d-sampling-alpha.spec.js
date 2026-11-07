import {test,expect} from '@playwright/test';
test('minified transparent textures retain source crop, opacity and backing fill',async({page})=>{
 await page.goto('/playground.html');
 const records=await page.evaluate(async()=>{
  const {decodePicture3d}=await import('/src/engine/canvas-picture-3d.js');
  const {shade3d}=await import('/src/engine/drawing-3d-lighting.js');
  const source=new OffscreenCanvas(1024,512),ctx=source.getContext('2d');
  ctx.fillStyle='blue';ctx.fillRect(512,0,512,512);
  const image=await createImageBitmap(source),records=[];
  try{for(const crop of [{left:0,right:0,top:0,bottom:0},{left:25000,right:25000,top:0,bottom:0},{left:-50000,right:-50000,top:0,bottom:0}])for(const backing of [false,true]){
   const asset={scene:{width:64*12700,height:32*12700,geometry:'rect',turn:0,perspective:false,depth:0,contour:0,contourColor:'FFFFFF',lighting:{rig:'threePt',direction:'t'},image:{assetId:'source',crop,opacity:.5},...(backing?{backingFill:{rgb:'FFFFFF',alpha:1}}:{})}};
   const d=await decodePicture3d(asset,new Map([['source',image]]));
   try{
    const output=new OffscreenCanvas(d.bitmap.width,d.bitmap.height),out=output.getContext('2d');out.drawImage(d.bitmap,0,0);
    const sample=f=>[...out.getImageData(Math.floor((64*f-d.left*.75)*8/3),Math.floor((16-d.top*.75)*8/3),1,1).data];
    records.push({crop,backing,left:sample(.1),right:sample(.65),litBlue:shade3d([0,0,255],[0,0,1],[0,0,1])});
   }finally{d.close();}
  }}finally{image.close();}
  return records;
 });
 for(const r of records){
  if(r.backing){expect(r.left).toEqual([255,255,255,255]);expect(r.right[3]).toBe(255);expect(r.right[2]).toBe(255);expect(r.right[0]).toBeGreaterThan(100);expect(r.right[0]).toBe(r.right[1]);}
  else{expect(r.left[3]).toBe(0);expect(r.right[3]).toBe(128);for(let i=0;i<3;i++)expect(Math.abs(r.right[i]-r.litBlue[i])).toBeLessThanOrEqual(1);}
 }
});
