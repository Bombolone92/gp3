import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';

test.use({deviceScaleFactor:3});
for(const suffix of ['', '-dark'])test(`automatic table borders match the native reference on ${suffix?'dark':'white'} pages through editing`,async({page},info)=>{
 test.setTimeout(120000);
 const root='tests/fixtures/automatic-table-borders/',source=root+`controls${suffix}.docx`,bytes=readFileSync(source),ref=JSON.parse(readFileSync(root+`native${suffix}-reference.json`));
 expect(createHash('sha256').update(bytes).digest('hex')).toBe(ref.sourceSha256);
 expect(createHash('sha256').update(readFileSync(root+`native${suffix}.pdf`)).digest('hex')).toBe(ref.pdfSha256);
 await page.goto('/playground.html');
 const available=await page.evaluate(async()=>{const {checkFontAvailability,fontAvailable}=await import('/src/engine/font-availability.js');await checkFontAvailability('Arial');return fontAvailable('Arial');});
 test.skip(!available,'Native reference geometry requires installed Arial.');
 await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});
 await expect(input).toHaveJSProperty('readOnly',false);
 await expect(input).not.toHaveValue('');
 const check=async()=>{
  await expect(page.locator('canvas.canvas-page')).toHaveCount(2);
  await expect.poll(()=>page.evaluate(pages=>pages.map((samples,index)=>{
   const canvas=document.querySelectorAll('canvas.canvas-page')[index],ctx=canvas.getContext('2d'),scale=canvas.width/612;
   return samples.map(s=>Array.from(ctx.getImageData(Math.round(s.x*scale),Math.round(s.y*scale),1,1).data).slice(0,3));
  }),ref.pages)).toEqual(ref.pages.map(samples=>samples.map(s=>s.color)));
 };
 await check();const original=await input.inputValue(),parts=unzipSync(bytes);
 const save=async name=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await pending).saveAs(path);return path;};
 expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
 await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');const edited=await save('edited');
 const after=unzipSync(readFileSync(edited));for(const [name,part] of Object.entries(parts))if(name!=='word/document.xml')expect(after[name]).toEqual(part);
 expect(new TextDecoder().decode(after['word/document.xml']).match(/w:color="auto"/g)?.length).toBe(new TextDecoder().decode(parts['word/document.xml']).match(/w:color="auto"/g)?.length);
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);await check();
 await reopenDocx(page,input,edited,'Edited '+original);await expect(input).toHaveJSProperty('readOnly',false);await check();
});
