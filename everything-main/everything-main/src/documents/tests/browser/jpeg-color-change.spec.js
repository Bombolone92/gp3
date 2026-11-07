import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
const root='tests/fixtures/jpeg-color-change/';
test('decodes JPEG color-key ranges using the encoded format and preserves PNG ranges',async({page})=>{
 await page.goto('/playground.html');
 const grid=JSON.parse(readFileSync(root+'thresholds.json')),native=JSON.parse(readFileSync(root+'reference.json'));
 const samples=await page.evaluate(async({bytes,grid})=>{
  const {DocxPackage}=await import('/src/engine/docx.js');const {decodeImages}=await import('/src/engine/images.js');
  const p=await DocxPackage.open(Uint8Array.from(atob(bytes),c=>c.charCodeAt(0))),bitmaps=await decodeImages(p.assets);
  try{return p.paragraphs.flatMap(p=>p.runs.filter(r=>r.image).map(r=>{
   const im=bitmaps.get(r.image.assetId),c=new OffscreenCanvas(im.width,im.height),ctx=c.getContext('2d');ctx.drawImage(im,0,0);
   const data=ctx.getImageData(0,0,im.width,im.height).data;
   return grid.colors.map((_,i)=>{const at=((Math.floor(i/grid.columns)*grid.size+grid.size/2)*im.width+i%grid.columns*grid.size+grid.size/2)*4;return [...data.slice(at,at+4)];});
  }));}finally{for(const b of bitmaps.values())b.close();}
 },{bytes:readFileSync(root+'thresholds.docx').toString('base64'),grid});
 const composite=rgba=>rgba.slice(0,3).map((v,k)=>Math.round(v*rgba[3]/255+[102,153,170][k]*(1-rgba[3]/255)));
 expect(samples).toHaveLength(native.samples.length);
 const mismatches=[];
 for(let i=0;i<samples.length;i++)for(let j=0;j<samples[i].length;j++){
  const actual=composite(samples[i][j]),expected=composite(native.samples[i][j]);
  const recompressed=native.pdfFilters[i]==='/DCTDecode';
  if(recompressed&&samples[i][j][3]!==255)mismatches.push({case:i,swatch:j,alpha:samples[i][j][3]});
  for(let k=0;k<3;k++)if(Math.abs(actual[k]-expected[k])>(recompressed?2:1))mismatches.push({case:i,swatch:j,channel:k,actual:actual[k],expected:expected[k]});
 }
 expect(mismatches).toEqual([]);
});
