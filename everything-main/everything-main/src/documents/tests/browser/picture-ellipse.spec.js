import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
const source='public/fixtures/picture-ellipse.docx';
const reference=JSON.parse(readFileSync('tests/fixtures/picture-ellipse/reference.json','utf8'));
test.use({deviceScaleFactor:3});
test('matches native picture-ellipse ink and preserves shape markup through edit, reopen and undo',async({page},info)=>{
 test.setTimeout(120000);
 expect(createHash('sha256').update(readFileSync(source)).digest('hex')).toBe(reference.sourceSha256);
 expect(createHash('sha256').update(readFileSync('tests/fixtures/picture-ellipse/native.pdf')).digest('hex')).toBe(reference.pdfSha256);
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^Ellipse picture controls/,{timeout:45000});await expect(input).toHaveJSProperty('readOnly',false);
 const check=async()=>{
  await expect(page.locator('#playground-error')).toBeEmpty();await expect(page.locator('canvas.canvas-page')).toHaveCount(2);
  const colors=await page.evaluate(samples=>{
   return samples.map(({x,y,page})=>{const canvas=document.querySelectorAll('canvas.canvas-page')[page],ctx=canvas.getContext('2d'),scale=canvas.width/612;return Array.from(ctx.getImageData(Math.round(x*scale),Math.round(y*scale),1,1).data).slice(0,3);});
  },reference.samples);
  for(const [i,sample] of reference.samples.entries()) {
   if(sample.case==='C6') for(let c=0;c<3;c++) expect(Math.abs(colors[i][c]-sample.color[c]),`sample ${i}, channel ${c}`).toBeLessThanOrEqual(3);
   else expect(colors[i],`sample ${i} ${sample.case}`).toEqual(sample.color);
  }
 };
 await check();writeFileSync(info.outputPath('picture-ellipse.png'),Buffer.from(await page.locator('canvas.canvas-page').first().evaluate(c=>c.toDataURL().split(',')[1]),'base64'));
 const original=await input.inputValue();await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');await check();
 const save=async suffix=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(`picture-ellipse${suffix}.docx`);await(await pending).saveAs(path);return path;};
 const edited=await save('-edited');await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);await check();
 const a=unzipSync(readFileSync(source)),b=unzipSync(readFileSync(await save('-undo')));for(const name of Object.keys(a))expect(Buffer.from(a[name]).equals(Buffer.from(b[name])),name).toBe(true);
 const savedXml=new TextDecoder().decode(unzipSync(readFileSync(edited))['word/document.xml']);
 const sourceXml=new TextDecoder().decode(unzipSync(readFileSync(source))['word/document.xml']);
 const groups=xml=>xml.match(/<(?:[\w]+:)?pic\b[\s\S]*?<\/(?:[\w]+:)?pic>/g);
 expect(groups(sourceXml)).toHaveLength(9);expect(groups(savedXml)).toEqual(groups(sourceXml));
 const previous=await input.elementHandle();page.once('dialog',d=>d.accept());await page.getByLabel('Open DOCX file').setInputFiles(edited);
 await expect.poll(()=>previous.evaluate(el=>el.isConnected),{timeout:45000}).toBe(false);await previous.dispose();
 await expect(input).toHaveValue('Edited '+original);await expect(input).toHaveJSProperty('readOnly',false);await check();
});
