import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';

const folder='tests/fixtures/shape-display-resolution/';
const source=folder+'control.docx';
const reference=JSON.parse(readFileSync(folder+'reference.json','utf8'));
const screen=JSON.parse(readFileSync(folder+'native-screen-reference.json','utf8'));
test.use({deviceScaleFactor:4});
test.describe.configure({timeout:120000});
async function open(page){
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});
 await expect(input).toHaveValue(/^Thin outline resolution controls/);
 await expect(input).toHaveJSProperty('readOnly',false);
 await expect(page.locator('canvas.canvas-page')).toHaveCount(1);
 return input;
}
test('high-DPI thin outlines match the native screen footprint',async({page})=>{
 for(const [file,hash] of [['control.docx',reference.sourceSha256],['native.pdf',reference.pdfSha256]])expect(createHash('sha256').update(readFileSync(folder+file)).digest('hex')).toBe(hash);
 expect(screen.sourceSha256).toBe(reference.sourceSha256);
 expect(createHash('sha256').update(readFileSync(folder+'native-screen-400-strip.png')).digest('hex')).toBe(screen.cropSha256);
 await open(page);
 const actual=await page.locator('canvas.canvas-page').evaluate((canvas,profiles)=>{
  const ctx=canvas.getContext('2d');return {size:[canvas.width,canvas.height],profiles:profiles.map(p=>Array.from({length:p.ink.length},(_,i)=>255-ctx.getImageData(p.x+i,p.y,1,1).data[0]))};
 },reference.profiles);
 expect(actual.size).toEqual(reference.pageSize);
 for(const p of actual.profiles)expect(p).toEqual(screen.ink);
});

test('physical raster retains the original native PDF antialiasing profiles',async({page})=>{
 await page.goto('/playground.html');
 const actual=await page.evaluate(async({bytes,profiles})=>{
  const {DocxPackage}=await import('/src/engine/docx.js');
  const {decodeShape}=await import('/src/engine/canvas-shapes.js');
  const {paintDecodedImage}=await import('/src/engine/images.js');
  const pkg=await DocxPackage.open(new Uint8Array(bytes));
  const asset=Object.values(pkg.assets).find(a=>a.scene);
  const image=await decodeShape(asset,new Map(),pkg.styles.fontAlternatives);
  // Explicit physical-raster fallback; screen hinting has its own native oracle.
  const view=image.forPage(undefined,{x:96,y:100*4/3,width:asset.width,height:asset.height,pixelRatio:4,axisAligned:false});
  const canvas=new OffscreenCanvas(3264,4224),ctx=canvas.getContext('2d');
  ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.scale(4,4);
  paintDecodedImage(ctx,view,96,100*4/3,asset.width,asset.height);
  const result=profiles.map(p=>Array.from({length:p.ink.length},(_,i)=>255-ctx.getImageData(p.x+i,p.y,1,1).data[0]));
  image.close();return result;
 },{bytes:[...readFileSync(source)],profiles:reference.profiles});
 for(const [i,p] of reference.profiles.entries())for(const [j,ink] of p.ink.entries())expect(Math.abs(actual[i][j]-ink),`profile ${i}, pixel ${j}`).toBeLessThanOrEqual(2);
});
test('high-DPI control preserves editable source and unrelated parts through undo and reopen',async({page},info)=>{
 const input=await open(page),original=await input.inputValue(),parts=unzipSync(readFileSync(source));
 const save=async suffix=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(suffix+'.docx');await(await pending).saveAs(path);return path;};
 const check=(path,edited)=>{const out=unzipSync(readFileSync(path));expect(Object.keys(out).sort()).toEqual(Object.keys(parts).sort());for(const name of Object.keys(parts))if(!edited||name!=='word/document.xml')expect(Buffer.from(out[name]).equals(Buffer.from(parts[name])),name).toBe(true);};
 check(await save('noedit'),false);await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');
 const edited=await save('edited');check(edited,true);await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);check(await save('undo'),false);
 await reopenDocx(page,input,edited,'Edited '+original);await expect(input).toHaveJSProperty('readOnly',false);await expect(page.locator('canvas.canvas-page')).toHaveCount(1);await expect(page.locator('#playground-error')).toBeEmpty();
});

test('zoom refreshes and releases scene surfaces, with a stable fallback under resource pressure',async({page})=>{
 await page.goto('/playground.html');
 const result=await page.evaluate(async encoded=>{
  const {DocxPackage}=await import('/src/engine/docx.js');
  const {decodeShape}=await import('/src/engine/canvas-shapes.js');
  const pkg=await DocxPackage.open(Uint8Array.from(atob(encoded),c=>c.charCodeAt(0)));
  const asset=Object.values(pkg.assets).find(a=>a.scene),changes=[];
  const image=await decodeShape(asset,new Map(),pkg.styles.fontAlternatives,(a,b)=>{changes.push(b.rasterScale);if(b.rasterScale>4)throw new Error('Session preview budget');});
  const place=pixelRatio=>({x:96,y:100*4/3,width:asset.width,height:asset.height,pixelRatio});
  const base=image.forPage(undefined,place(1));
  const large=image.forPage(undefined,place(4));
  const repeat=image.forPage(undefined,place(4));
  const cached=repeat===large,oldClosed=base.bitmap.width===0;
  const pressured=image.forPage(undefined,place(6));
  const pressureCached=image.forPage(undefined,place(6))===pressured;
  const reduced=image.forPage(undefined,place(1));
  const sizes=[large.rasterScale,pressured.rasterScale,reduced.rasterScale];
  const largeClosed=large.bitmap.width===0;
  image.close();return {changes,cached,oldClosed,pressureCached,sizes,largeClosed,closed:reduced.bitmap.width===0};
 },readFileSync(source).toString('base64'));
 // The first callback replaces the reserved surface with its placed bitmap.
 expect(result).toEqual({changes:[2,4,6,2,2],cached:true,oldClosed:true,pressureCached:true,sizes:[4,2,2],largeClosed:true,closed:true});
});

test('high-DPI pattern tiles keep native physical cell size and page phase',async({page})=>{
 const patternFolder='tests/fixtures/pattern-fills/',ref=JSON.parse(readFileSync(patternFolder+'reference.json'));
 const bytes=readFileSync(patternFolder+'controls.docx');expect(createHash('sha256').update(bytes).digest('hex')).toBe(ref.sourceSha256);
 await page.goto('/playground.html');
 const samples=await page.evaluate(async encoded=>{
  const {DocxPackage}=await import('/src/engine/docx.js'),{decodeShape}=await import('/src/engine/canvas-shapes.js'),{paintDecodedImage}=await import('/src/engine/images.js');
  const pkg=await DocxPackage.open(Uint8Array.from(atob(encoded),c=>c.charCodeAt(0))),samples=[];
  for(const asset of Object.values(pkg.assets).filter(a=>a.scene).slice(0,54)){
   const image=await decodeShape(asset,new Map(),pkg.styles.fontAlternatives),canvas=new OffscreenCanvas(128,128),ctx=canvas.getContext('2d');
   ctx.fillStyle='#fff';ctx.fillRect(0,0,128,128);ctx.scale(4,4);paintDecodedImage(ctx,image,0,0,asset.width,asset.height);
   const sample=[];for(let y=0;y<8;y++)for(let x=0;x<8;x++)sample.push(...ctx.getImageData((16+x)*4+2,(16+y)*4+2,1,1).data.slice(0,3));
   samples.push(sample);image.close();
  }return samples;
 },bytes.toString('base64'));
 expect(samples).toHaveLength(54);
 for(const [i,sample] of samples.entries()){
  const expected=[...Buffer.from(ref.pages[i].sample96,'hex')];
  for(const [c,value] of sample.entries())expect(Math.abs(value-expected[c]),`${ref.pages[i].name}, channel ${c}`).toBeLessThanOrEqual(2);
 }
});
