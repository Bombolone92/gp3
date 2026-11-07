import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
const hash=b=>createHash('sha256').update(b).digest('hex');
for(const [name,indices] of [['emf-miter-text',[0,1,2]],['emf-miter-text-integers',[0,1,2,3]],['emf-miter-text-empty-buffers',[0,1,2,3]],['emf-miter-text-effects',[0,1,2,3]]]){
 test(`${name} effect corners follow native text-record interpretation`,async({page},info)=>{
  test.setTimeout(120000);
  const folder=`tests/fixtures/${name}`,source=readFileSync(`${folder}/control.docx`),ref=JSON.parse(readFileSync(`${folder}/native-reference.json`));
  expect(hash(source)).toBe(ref.provenance.sourceSha256);expect(hash(readFileSync(`${folder}/native.emf`))).toBe(ref.provenance.captureSha256);
  const native=indices.map(i=>{const png=readFileSync(`${folder}/native-${i}.png`);expect(hash(png)).toBe(ref.images[i].pngSha256);return {index:i,size:ref.images[i].size,bytes:[...png]};});
  await page.goto('/playground.html');
  const rows=await page.evaluate(async({bytes,native})=>{
   const {DocxPackage}=await import('/src/engine/docx.js'),{decodeImage}=await import('/src/engine/images.js'),{decodeEmf,emfInfo}=await import('/src/engine/emf-images.js');
   const {vectorImage,imageWithPixelEffects,vectorEffectSample}=await import('/src/engine/vector-image-effects.js');
   const pkg=await DocxPackage.open(new Uint8Array(bytes)),pictures=pkg.paragraphs.flatMap(p=>p.runs.filter(r=>r.image).map(r=>r.image)).filter((_,i)=>i%2),assets=pictures.map(p=>pkg.assets[p.assetId]),rows=[];
   if(assets.length!==4)throw Error('Expected four paired effect pictures');
   for(const entry of native){
    const asset=assets[entry.index],[w,h]=entry.size,c=new OffscreenCanvas(w,h),ctx=c.getContext('2d');
    const bitmap=await createImageBitmap(new Blob([new Uint8Array(entry.bytes)],{type:'image/png'}));ctx.drawImage(bitmap,0,0);bitmap.close();const expected=ctx.getImageData(0,0,w,h).data;
    const actualOwner=await decodeImage(asset),base=await decodeEmf(asset.bytes),baselineOwner=imageWithPixelEffects(vectorImage(base,{rasterFrame:emfInfo(asset.bytes,{pixelEffects:true}).rasterFrame}),()=>{});
    const sample=owner=>{const image=vectorEffectSample(owner,w,h);if(image.width!==w||image.height!==h)throw Error('Wrong raster dimensions');ctx.clearRect(0,0,w,h);ctx.globalAlpha=pictures[entry.index].opacity??1;ctx.drawImage(image,0,0);ctx.globalAlpha=1;return ctx.getImageData(0,0,w,h).data;};
    let actual,baseline;try{actual=sample(actualOwner);baseline=sample(baselineOwner);}finally{actualOwner.close();baselineOwner.close();}
    const maxAlpha=data=>{let m=0;for(let i=3;i<data.length;i+=4)m=Math.max(m,data[i]);return m;},nativeMax=maxAlpha(expected);
    const cornerError=data=>{let sum=0,n=0;const max=maxAlpha(data);for(let y=0;y<Math.floor(h/20);y++)for(let x=0;x<Math.floor(w/20);x++){const p=(y*w+x)*4+3;sum+=Math.abs(data[p]*255/max-expected[p]*255/nativeMax);n++;}return sum/n;};
    const tip=data=>{const threshold=Math.floor(maxAlpha(data)*175/255);for(let y=Math.floor(h/20);y<h/3;y++)for(let x=Math.floor(w/3);x<2*w/3;x++)if(data[(y*w+x)*4+3]>threshold)return y;return null;};
    const bounds=data=>{const b=[w,h,-1,-1],threshold=Math.floor(maxAlpha(data)*175/255);for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(data[(y*w+x)*4+3]>threshold){b[0]=Math.min(b[0],x);b[1]=Math.min(b[1],y);b[2]=Math.max(b[2],x);b[3]=Math.max(b[3],y);}return b;};
    const nativeTip=tip(expected),actualTip=tip(actual),baselineTip=tip(baseline);
    rows.push({index:entry.index,size:[w,h],nativeTip,actualTip,baselineTip,actualMaxAlpha:maxAlpha(actual),nativeMaxAlpha:nativeMax,actualBounds:bounds(actual),baselineBounds:bounds(baseline),nativeBounds:bounds(expected),cornerError:cornerError(actual),baselineCornerError:cornerError(baseline),changed:!actual.every((v,i)=>i%4!==3||v===baseline[i])});
   }
   return rows;
  },{bytes:[...source],native});
  writeFileSync(info.outputPath('native-corners.json'),JSON.stringify(rows,null,2));
  for(const row of rows){
   expect(row.actualBounds).toEqual(row.baselineBounds);
   expect(row.cornerError,JSON.stringify(row)).toBeLessThanOrEqual(row.baselineCornerError);
   expect(Math.abs(row.actualTip-row.nativeTip),JSON.stringify(row)).toBeLessThanOrEqual(Math.abs(row.baselineTip-row.nativeTip));
   if(row.changed)expect(row.baselineCornerError-row.cornerError,JSON.stringify(row)).toBeGreaterThan(5);
  }
 });
 test(`${name} preserves original media through editing, export, reopen and undo`,async({page},info)=>{
  test.setTimeout(120000);const source=`tests/fixtures/${name}/control.docx`,parts=unzipSync(readFileSync(source));
  await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
  const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^Shape defaults controls/,{timeout:90000});await expect(input).toBeEditable();
  const save=async label=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(label+'.docx');await(await pending).saveAs(path);return path;};
  expect(unzipSync(readFileSync(await save('no-edit')))).toEqual(parts);
  const original=await input.inputValue();await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');
  const edited=await save('edited'),out=unzipSync(readFileSync(edited));for(const name of Object.keys(parts))if(name!=='word/document.xml')expect(out[name]).toEqual(parts[name]);
  await input.press('ControlOrMeta+z');expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);
  await reopenDocx(page,input,edited,'Edited '+original);await expect(page.locator('#playground-error')).toBeEmpty();
  await page.screenshot({path:info.outputPath('control.png'),fullPage:true});
 });
}
test('neutral luminance on a text-bearing EMF retains the original vector pixels',async({page})=>{
 test.setTimeout(120000);await page.goto('/playground.html');
 const equal=await page.evaluate(async bytes=>{
  const {DocxPackage}=await import('/src/engine/docx.js'),{decodeImage}=await import('/src/engine/images.js'),{vectorEffectSample}=await import('/src/engine/vector-image-effects.js');
  const pkg=await DocxPackage.open(new Uint8Array(bytes)),asset=Object.values(pkg.assets).find(a=>a.pictureEffects),{pictureEffects,...plainAsset}=asset;
  const plain=await decodeImage(plainAsset),neutral=await decodeImage({...plainAsset,pictureEffects:[{type:'luminance',brightness:0,contrast:0}]});
  try{const c=new OffscreenCanvas(800,788),ctx=c.getContext('2d');ctx.drawImage(plain,0,0,800,788);const a=ctx.getImageData(0,0,800,788).data;ctx.clearRect(0,0,800,788);ctx.drawImage(vectorEffectSample(neutral,800,788),0,0,800,788);return ctx.getImageData(0,0,800,788).data.every((v,i)=>v===a[i]);}finally{plain.close();neutral.close();}
 },[...readFileSync('tests/fixtures/emf-miter-text-integers/control.docx')]);expect(equal).toBe(true);
});
