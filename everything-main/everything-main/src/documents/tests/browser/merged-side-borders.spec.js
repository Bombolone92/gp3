import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
import {expectBodyEditParts} from './helpers/expect-body-edit-parts.js';
const root='tests/fixtures/merged-side-borders/',source=root+'controls.docx',bytes=readFileSync(source),ref=JSON.parse(readFileSync(root+'reference.json'));
test.use({deviceScaleFactor:3});
test('matches native physical merged sides through editing',async({page},info)=>{
 test.setTimeout(120000);
 expect(createHash('sha256').update(bytes).digest('hex')).toBe(ref.sourceSha256);
 await page.goto('/playground.html');
 const available=await page.evaluate(async()=>{const{checkFontAvailability,fontAvailable}=await import('/src/engine/font-availability.js');await checkFontAvailability('Arial');return fontAvailable('Arial');});
 test.skip(!available,'Native row geometry requires installed Arial.');
 await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^restart-only/);await expect(input).toHaveJSProperty('readOnly',false);
 const check=async()=>{
  await expect(page.locator('canvas.canvas-page')).toHaveCount(6);
  const results=await page.evaluate(cases=>cases.map((c,index)=>{
   const canvas=document.querySelectorAll('canvas.canvas-page')[index],paint=canvas.getContext('2d'),scale=canvas.width/612;
   return c.samples.map(s=>Array.from(paint.getImageData(Math.round(s.x*scale),Math.round(s.y*scale),1,1).data).slice(0,3));
  }),ref.cases);
  for(const [i,c] of ref.cases.entries()){
   for(const [j,sample] of c.samples.entries())for(let k=0;k<3;k++)expect(Math.abs(results[i][j][k]-sample.rgb[k]),c.name+' row '+j).toBeLessThanOrEqual(2);

  }
 };
 await check();const original=await input.inputValue(),parts=unzipSync(bytes);
 const save=async name=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await pending).saveAs(path);return path;};
 expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
 await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');const edited=await save('edited');
 const after=unzipSync(readFileSync(edited));expectBodyEditParts(after,parts);
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);await check();
 await reopenDocx(page,input,edited,'Edited '+original);await expect(input).toHaveJSProperty('readOnly',false);await check();
});
