import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
const source='public/fixtures/dense-guides.docx';
const reference=JSON.parse(readFileSync('tests/fixtures/dense-guides/reference.json','utf8'));
test.use({deviceScaleFactor:3});
test('matches native dense-guides ink and preserves every guide through edit, reopen and undo',async({page},info)=>{
 test.setTimeout(120000);
 expect(createHash('sha256').update(readFileSync(source)).digest('hex')).toBe(reference.sourceSha256);
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^Dense guide geometry/,{timeout:45000});await expect(input).toHaveJSProperty('readOnly',false);
 const check=async()=>{
  await expect(page.locator('#playground-error')).toBeEmpty();await expect(page.locator('canvas.canvas-page')).toHaveCount(1);
  const rows=await page.evaluate(rows=>{
   const canvas=document.querySelector('canvas.canvas-page'),ctx=canvas.getContext('2d'),scale=canvas.width/612;
   return rows.map(row=>{const xs=[];for(let x=Math.round(80*scale);x<420*scale;x++){
    const p=ctx.getImageData(x,Math.round(row.y*scale),1,1).data;if(Math.abs(p[0]-32)+Math.abs(p[1]-128)+Math.abs(p[2]-96)<30)xs.push(x);
   }return xs.length?[xs[0]/scale,(xs.at(-1)+1)/scale]:null;});
  },reference.rows);
  for(const [i,row] of reference.rows.entries()){
   expect(Boolean(rows[i]),`y=${row.y}`).toBe(Boolean(row.interval));
   if(row.interval)for(const edge of [0,1])expect(Math.abs(rows[i][edge]-row.interval[edge]),`y=${row.y}`).toBeLessThanOrEqual(.75);
  }
 };
 const geometry=await page.evaluate(async()=>{
  const {DocxPackage}=await import('/src/engine/docx.js');
  const pkg=await DocxPackage.open(new Uint8Array(await(await fetch('/fixtures/dense-guides.docx')).arrayBuffer()));
  const points=Object.values(pkg.assets)[0].scene.paths[0].points;
  return {count:points.length,samples:[0,1,2,3,4].map(i=>points[i])};
 });
 expect(geometry.count).toBe(reference.commandCount);
 expect(geometry.samples).toEqual([['M',0,0],['L',32768,0],['L',32768,49152],['L',0,49152],['Z']]);
 await check();writeFileSync(info.outputPath('dense-guides.png'),Buffer.from(await page.locator('canvas.canvas-page').evaluate(c=>c.toDataURL().split(',')[1]),'base64'));
 const original=await input.inputValue();await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');await check();
 const save=async suffix=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(`dense-guides${suffix}.docx`);await(await pending).saveAs(path);return path;};
 const edited=await save('-edited');await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);await check();
 const a=unzipSync(readFileSync(source)),b=unzipSync(readFileSync(await save('-undo')));for(const name of Object.keys(a))expect(Buffer.from(a[name]).equals(Buffer.from(b[name])),name).toBe(true);
 const savedXml=new TextDecoder().decode(unzipSync(readFileSync(edited))['word/document.xml']);expect((savedXml.match(/<a:gd /g)||[]).length).toBe(reference.guideCount+1);
 const previous=await input.elementHandle();page.once('dialog',d=>d.accept());await page.getByLabel('Open DOCX file').setInputFiles(edited);
 await expect.poll(()=>previous.evaluate(el=>el.isConnected),{timeout:45000}).toBe(false);await previous.dispose();
 await expect(input).toHaveValue('Edited '+original);await expect(input).toHaveJSProperty('readOnly',false);await check();
});
