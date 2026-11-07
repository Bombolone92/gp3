import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
const source='public/fixtures/picture-geometry.docx';
const reference=JSON.parse(readFileSync('tests/fixtures/picture-geometry/reference.json','utf8'));
test.use({deviceScaleFactor:3});
test('matches native picture-geometry ink and preserves shape markup through edit, reopen and undo',async({page},info)=>{
 test.setTimeout(120000);
 expect(createHash('sha256').update(readFileSync(source)).digest('hex')).toBe(reference.sourceSha256);
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^Picture geometry controls/,{timeout:45000});await expect(input).toHaveJSProperty('readOnly',false);
 const alpha=await page.evaluate(async()=>{
  const {DocxPackage}=await import('/src/engine/docx.js');
  const {decodeShape}=await import('/src/engine/canvas-shapes.js');
  const pkg=await DocxPackage.open(new Uint8Array(await(await fetch('/fixtures/picture-geometry.docx')).arrayBuffer()));
  const bitmaps=new Map();
  for(const [id,a] of Object.entries(pkg.assets))if(a.bytes)bitmaps.set(id,await createImageBitmap(new Blob([a.bytes],{type:a.mime})));
  const asset=Object.values(pkg.assets).filter(a=>a.scene)[11],decoded=await decodeShape(asset,bitmaps);
  const canvas=new OffscreenCanvas(decoded.bitmap.width,decoded.bitmap.height),ctx=canvas.getContext('2d');ctx.drawImage(decoded.bitmap,0,0);
  const result=[.125,.375].map(f=>ctx.getImageData(Math.floor(canvas.width*f),Math.floor(canvas.height*f),1,1).data[3]);
  decoded.close();for(const bitmap of bitmaps.values())bitmap.close();return result;
 });
 // Check compositing independently of the reference PDF's premultiplied color rounding.
 expect(Math.abs(alpha[0]-127.5)).toBeLessThanOrEqual(1);
 expect(Math.abs(alpha[1]-191.25)).toBeLessThanOrEqual(1);
 const check=async()=>{
  await expect(page.locator('#playground-error')).toBeEmpty();await expect(page.locator('canvas.canvas-page')).toHaveCount(1);
  const colors=await page.evaluate(samples=>{
   const canvas=document.querySelector('canvas.canvas-page'),ctx=canvas.getContext('2d'),scale=canvas.width/612;
   return samples.map(({x,y})=>Array.from(ctx.getImageData(Math.round(x*scale),Math.round(y*scale),1,1).data).slice(0,3));
  },reference.samples);
  for(const [i,sample] of reference.samples.entries()) {
   // Picture-alpha permits three RGB levels per composited layer. This control
   // includes two overlapping translucent paths; opaque samples remain exact.
   if(sample.case===12) for(let c=0;c<3;c++) expect(Math.abs(colors[i][c]-sample.color[c]),`sample ${i}, channel ${c}`).toBeLessThanOrEqual(6);
   else expect(colors[i],`sample ${i}`).toEqual(sample.color);
  }
 };
 await check();writeFileSync(info.outputPath('picture-geometry.png'),Buffer.from(await page.locator('canvas.canvas-page').evaluate(c=>c.toDataURL().split(',')[1]),'base64'));
 const original=await input.inputValue();await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');await check();
 const save=async suffix=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(`picture-geometry${suffix}.docx`);await(await pending).saveAs(path);return path;};
 const edited=await save('-edited');await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);await check();
 const a=unzipSync(readFileSync(source)),b=unzipSync(readFileSync(await save('-undo')));for(const name of Object.keys(a))expect(Buffer.from(a[name]).equals(Buffer.from(b[name])),name).toBe(true);
 const savedXml=new TextDecoder().decode(unzipSync(readFileSync(edited))['word/document.xml']);
 const sourceXml=new TextDecoder().decode(unzipSync(readFileSync(source))['word/document.xml']);
 const groups=xml=>xml.match(/<(?:[\w]+:)?pic\b[\s\S]*?<\/(?:[\w]+:)?pic>/g);
 expect(groups(sourceXml)).toHaveLength(12);expect(groups(savedXml)).toEqual(groups(sourceXml));
 const previous=await input.elementHandle();page.once('dialog',d=>d.accept());await page.getByLabel('Open DOCX file').setInputFiles(edited);
 await expect.poll(()=>previous.evaluate(el=>el.isConnected),{timeout:45000}).toBe(false);await previous.dispose();
 await expect(input).toHaveValue('Edited '+original);await expect(input).toHaveJSProperty('readOnly',false);await check();
});


