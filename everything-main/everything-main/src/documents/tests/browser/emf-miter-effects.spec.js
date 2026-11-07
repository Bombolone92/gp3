import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
for(const variant of ['a','b'])test(`native effect miter interpretation ${variant} retains bevel and acute joins`,async({page},info)=>{
 test.setTimeout(120000);
 const folder=`tests/fixtures/emf-miter-effects-${variant}`,source=readFileSync(`${folder}/control.docx`);
 const reference=JSON.parse(readFileSync(`${folder}/native-reference.json`));
 expect(hash(source)).toBe(reference.provenance.sourceSha256);
 expect(hash(readFileSync(`${folder}/native.emf`))).toBe(reference.provenance.captureSha256);
 const native=reference.images.map((entry,i)=>{const png=readFileSync(`${folder}/native-${i}.png`);expect(hash(png)).toBe(entry.pngSha256);return {bytes:[...png],size:entry.size};});
 await page.goto('/playground.html');
 const rows=await page.evaluate(async({bytes,native})=>{
  const {DocxPackage}=await import('/src/engine/docx.js'),{decodeImage}=await import('/src/engine/images.js'),{vectorEffectSample}=await import('/src/engine/vector-image-effects.js');
  const pkg=await DocxPackage.open(new Uint8Array(bytes)),assets=Object.values(pkg.assets).filter(a=>a.pictureEffects);
  if(assets.length!==4)throw Error('Expected four effect pictures');
  const rows=[];
  for(let i=0;i<4;i++){
   const [w,h]=native[i].size,c=new OffscreenCanvas(w,h),ctx=c.getContext('2d');
   const bitmap=await createImageBitmap(new Blob([new Uint8Array(native[i].bytes)],{type:'image/png'}));
   ctx.drawImage(bitmap,0,0);bitmap.close();const expected=ctx.getImageData(0,0,w,h).data;
   const owner=await decodeImage(assets[i]);let actual;
   try{const sample=vectorEffectSample(owner,w,h);if(sample.width!==w||sample.height!==h)throw Error('Wrong sample dimensions');ctx.clearRect(0,0,w,h);ctx.drawImage(sample,0,0);actual=ctx.getImageData(0,0,w,h).data;}finally{owner.close();}
   const tip=data=>{for(let y=Math.floor(h/20);y<h/3;y++)for(let x=Math.floor(w/3);x<2*w/3;x++)if(data[(y*w+x)*4+3]>175)return y;throw Error('No acute join');};
   rows.push({row:i,size:[w,h],nativeTip:tip(expected),actualTip:tip(actual)});
  }
  return rows;
 },{bytes:[...source],native});
 writeFileSync(info.outputPath('miter-tips.json'),JSON.stringify(rows,null,2));
 for(const row of rows)expect(Math.abs(row.actualTip-row.nativeTip),JSON.stringify(row)).toBeLessThanOrEqual(1);
});
