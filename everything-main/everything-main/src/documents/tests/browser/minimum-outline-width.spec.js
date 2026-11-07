import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
const source='tests/fixtures/minimum-outline-width/shape.docx';
test('paints zero and subminimum single outlines with the same physical pen',async({page})=>{
  await page.goto('/playground.html');
  const actual=await page.evaluate(async bytes=>{
    const {DocxPackage}=await import('/src/engine/docx.js');
    const {decodeImages}=await import('/src/engine/images.js');
    const pkg=await DocxPackage.open(Uint8Array.from(atob(bytes),c=>c.charCodeAt(0)));
    const decoded=await decodeImages(pkg.assets,pkg.styles.fontAlternatives),rasters=[];
    for(const image of decoded.values()){
      if(!image.bitmap)continue;
      const c=document.createElement('canvas');c.width=image.bitmap.width;c.height=image.bitmap.height;
      const ctx=c.getContext('2d');ctx.drawImage(image.bitmap,0,0);
      const data=ctx.getImageData(0,0,c.width,c.height).data;
      rasters.push({png:c.toDataURL(),ink:data.some((v,i)=>i%4===3&&v>0)});
      image.close();
    }
    return rasters;
  },readFileSync(source).toString('base64'));
  expect(actual).toHaveLength(32);
  for(let i=0;i<14;i++){
    expect(actual[i].ink).toBe(true);
    expect(actual[i].png).toBe(actual[i%2].png);
  }
  // Above the boundary the native pen remains distinct.
  expect(actual[30].png).not.toBe(actual[0].png);
});
