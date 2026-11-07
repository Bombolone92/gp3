import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';

const folder='tests/fixtures/emf-luminance-edges';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function nativeImages(name){
 const reference=JSON.parse(readFileSync(`${folder}/range-native/${name}-reference.json`));
 const capture=readFileSync(`${folder}/range-native/${name}.emf`);
 expect(hash(capture)).toBe(reference.provenance.captureSha256);
 const images=[];
 for(let at=0;at<capture.length;){
  const size=capture.readUInt32LE(at+4);expect(size).toBeGreaterThanOrEqual(8);expect(at+size).toBeLessThanOrEqual(capture.length);
  if(capture.readUInt32LE(at)===70&&capture.subarray(at+12,at+16).toString()==='EMF+'){
   const end=at+12+capture.readUInt32LE(at+8);expect(end).toBeLessThanOrEqual(at+size);
   for(let p=at+16;p<end;){
    const type=capture.readUInt16LE(p),flags=capture.readUInt16LE(p+2),length=capture.readUInt32LE(p+4),count=capture.readUInt32LE(p+8);
    expect(length).toBeGreaterThanOrEqual(12);expect(p+length).toBeLessThanOrEqual(end);expect(count).toBeLessThanOrEqual(length-12);
    if(type===0x4008&&(flags>>8&127)===5&&capture.readUInt32LE(p+16)===1){
     expect(flags&0x8000).toBe(0);expect(capture.readUInt32LE(p+36)).toBe(1);
     const bytes=capture.subarray(p+40,p+12+count),entry=reference.images[images.length];
     expect(hash(bytes)).toBe(entry.pngSha256);images.push({bytes:[...bytes],size:entry.size});
    }
    p+=length;
   }
  }
  at+=size;
 }
 expect(images).toHaveLength(4);return {reference,images};
}

for(const[name,suffix]of[['base',''],['expanded','-expanded-frame'],['overflow','-overflow-frame']]){
 test(`EMF effect raster preserves the native physical-frame geometry at all four ${name} sizes`,async({page},info)=>{
  test.setTimeout(120000);
  const native=nativeImages(name),source=readFileSync(`${folder}${suffix}/control.docx`);
  expect(hash(source)).toBe(native.reference.provenance.sourceSha256);
  await page.goto('/playground.html');
  const rows=await page.evaluate(async({bytes,native})=>{
   const {DocxPackage}=await import('/src/engine/docx.js'),{decodeImage}=await import('/src/engine/images.js'),{vectorEffectSample}=await import('/src/engine/vector-image-effects.js');
   const pkg=await DocxPackage.open(new Uint8Array(bytes)),assets=Object.values(pkg.assets).filter(a=>a.pictureEffects);
   if(assets.length!==4)throw Error('Expected four independently authored luminance pictures');
   const results=[];
   for(let i=0;i<4;i++){
    const [width,height]=native[i].size,c=new OffscreenCanvas(width,height),ctx=c.getContext('2d');
    const image=await createImageBitmap(new Blob([new Uint8Array(native[i].bytes)],{type:'image/png'}));
    try{ctx.drawImage(image,0,0);}finally{image.close();}
    const expected=ctx.getImageData(0,0,width,height).data;
    const owner=await decodeImage(assets[i]);
    let actual;
    try{const sample=vectorEffectSample(owner,width,height);ctx.clearRect(0,0,width,height);ctx.drawImage(sample,0,0);actual=ctx.getImageData(0,0,width,height).data;}finally{owner.close();}
    const bounds=data=>{const b=[width,height,-1,-1];for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(data[(y*width+x)*4+3]>175){b[0]=Math.min(b[0],x);b[1]=Math.min(b[1],y);b[2]=Math.max(b[2],x);b[3]=Math.max(b[3],y);}return b;};
    let error=0,coverage=0,nativeCoverage=0;for(let j=3;j<actual.length;j+=4){error+=Math.abs(actual[j]-expected[j]);coverage+=actual[j];nativeCoverage+=expected[j];}
    results.push({row:i,size:[width,height],bounds:bounds(actual),nativeBounds:bounds(expected),alphaMeanError:error/(width*height),coverageRatio:coverage/nativeCoverage});
   }
   return results;
  },{bytes:[...source],native:native.images});
  writeFileSync(info.outputPath('native-raster-comparison.json'),JSON.stringify(rows,null,2));
  for(const row of rows){
   expect(row.bounds,`row ${row.row} dark bounds`).toEqual(row.nativeBounds);
   expect(row.alphaMeanError,`row ${row.row} alpha`).toBeLessThan(.75);
   expect(row.coverageRatio,`row ${row.row} coverage`).toBeGreaterThan(.99);
   expect(row.coverageRatio,`row ${row.row} coverage`).toBeLessThan(1.01);
  }
 });
}

test('neutral EMF luminance retains the unadjusted viewport at every raster resolution',async({page})=>{
 test.setTimeout(120000);await page.goto('/playground.html');
 const results=await page.evaluate(async bytes=>{
  const {DocxPackage}=await import('/src/engine/docx.js'),{decodeImage}=await import('/src/engine/images.js'),{vectorEffectSample}=await import('/src/engine/vector-image-effects.js');
  const pkg=await DocxPackage.open(new Uint8Array(bytes)),asset=Object.values(pkg.assets).find(a=>a.mime==='image/emf'&&!a.pictureEffects);
  const plain=await decodeImage(asset),neutral=await decodeImage({...asset,pictureEffects:[{type:'luminance',brightness:0,contrast:0}]});
  try{return [[400,394],[599,590],[800,787]].map(([w,h])=>{
   const c=new OffscreenCanvas(w,h),ctx=c.getContext('2d');ctx.drawImage(plain,0,0,w,h);const expected=ctx.getImageData(0,0,w,h).data;
   ctx.clearRect(0,0,w,h);ctx.drawImage(vectorEffectSample(neutral,w,h),0,0);const actual=ctx.getImageData(0,0,w,h).data;
   return actual.every((v,i)=>v===expected[i]);
  });}finally{plain.close();neutral.close();}
 },[...readFileSync(`${folder}/control.docx`)]);
 expect(results).toEqual([true,true,true]);
});

for(const suffix of ['','-inset-bounds','-expanded-frame','-overflow-frame'])test(`EMF effect document${suffix} retains editing, original media and exact undo`,async({page},info)=>{
 test.setTimeout(120000);
 const source=`${folder}${suffix}/control.docx`,parts=unzipSync(readFileSync(source));
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});
 await expect(input).toHaveValue(/^Shape defaults controls/,{timeout:90000});await expect(input).toBeEditable();
 const save=async name=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await pending).saveAs(path);return path;};
 expect(unzipSync(readFileSync(await save('no-edit')))).toEqual(parts);
 const original=await input.inputValue();await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');
 const edited=await save('edited'),out=unzipSync(readFileSync(edited));
 for(const name of Object.keys(parts))if(name!=='word/document.xml')expect(out[name]).toEqual(parts[name]);
 await input.press('ControlOrMeta+z');expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);
 await reopenDocx(page,input,edited,'Edited '+original);
 await expect(page.locator('#playground-error')).toBeEmpty();
 await page.screenshot({path:info.outputPath('control.png'),fullPage:true});
});
