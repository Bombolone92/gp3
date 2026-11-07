import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
test.use({deviceScaleFactor:3});
for (const fixture of ['inactive-normal-autofit','corner-star5','corner-octagon','corner-plaque','corner-roundRect','corner-round2SameRect','hexagon-shapes','arrow-homePlate','arrow-chevron','triangle-shapes','frame-shapes','shape-defaults','shape-upright-inactive','hidden-fill-controls','shape-inactive-tabs','shape-compound-outlines','shape-compound-ellipses','shape-compound-ellipses-half','shape-outline-default-width','emf-paths','emf-paths-float-miter','emf-paths-inset-bounds']) {
const source=`public/fixtures/${fixture}.docx`;
const reference=JSON.parse(readFileSync(`tests/fixtures/${fixture}/reference.json`,'utf8'));

test(`matches native ${fixture} ink and preserves shape markup through edit, reopen and undo`,async({page},info)=>{
 test.setTimeout(120000);
 expect(createHash('sha256').update(readFileSync(source)).digest('hex')).toBe(reference.sourceSha256);
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^Shape defaults controls/,{timeout:45000});await expect(input).toHaveJSProperty('readOnly',false);
 const check=async()=>{
  await expect(page.locator('#playground-error')).toBeEmpty();await expect(page.locator('canvas.canvas-page')).toHaveCount(1);
  const colors=await page.evaluate(samples=>{
   const canvas=document.querySelector('canvas.canvas-page'),ctx=canvas.getContext('2d'),scale=canvas.width/612;
   return samples.map(({x,y})=>Array.from(ctx.getImageData(Math.round(x*scale),Math.round(y*scale),1,1).data).slice(0,3));
  },reference.samples);
  const mismatches=reference.samples.flatMap((sample,i)=>colors[i].some((value,j)=>value!==sample.color[j])?[{i,expected:sample.color,actual:colors[i]}]:[]);
  expect(mismatches.length,JSON.stringify(mismatches.slice(0,8))).toBe(0);
 };
 await check();writeFileSync(info.outputPath('shape-defaults.png'),Buffer.from(await page.locator('canvas.canvas-page').evaluate(c=>c.toDataURL().split(',')[1]),'base64'));
 const original=await input.inputValue();await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');await check();
 const save=async suffix=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(`shape-defaults${suffix}.docx`);await(await pending).saveAs(path);return path;};
 const edited=await save('-edited');await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);await check();
 const a=unzipSync(readFileSync(source)),b=unzipSync(readFileSync(await save('-undo')));for(const name of Object.keys(a))expect(Buffer.from(a[name]).equals(Buffer.from(b[name])),name).toBe(true);
 const savedXml=new TextDecoder().decode(unzipSync(readFileSync(edited))['word/document.xml']);
 const sourceXml=new TextDecoder().decode(unzipSync(readFileSync(source))['word/document.xml']);
 const shapeTag=fixture.startsWith('emf-paths')?'pic':'wsp';
 const groups=xml=>xml.match(new RegExp('<(?:[\\w]+:)?'+shapeTag+'\\b[\\s\\S]*?<\\/(?:[\\w]+:)?'+shapeTag+'>','g'));
 expect(groups(sourceXml)).toHaveLength(8);expect(groups(savedXml)).toEqual(groups(sourceXml));
 const previous=await input.elementHandle();page.once('dialog',d=>d.accept());await page.getByLabel('Open DOCX file').setInputFiles(edited);
 await expect.poll(()=>previous.evaluate(el=>el.isConnected),{timeout:45000}).toBe(false);await previous.dispose();
 await expect(input).toHaveValue('Edited '+original);await expect(input).toHaveJSProperty('readOnly',false);await check();
});


}
