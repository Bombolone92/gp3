import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
import {downloadDocx} from './helpers/editor-tools.js';
import {reopenDocx} from './helpers/reopen-docx.js';
test.describe.configure({timeout:120000});
const root='tests/fixtures/table-grid-phase/';
for(const fixture of ['control','holdout'])test(`${fixture}: native row bands, cell edit, export and undo`,async({page},info)=>{
 const source=root+fixture+'.docx',original=unzipSync(readFileSync(source)),ref=JSON.parse(readFileSync(root+fixture+'-reference.json'));
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});
 await expect(input).toHaveJSProperty('readOnly',false);await expect(page.locator('canvas.canvas-page')).toHaveCount(1);
 const bands=async()=>page.locator('canvas.canvas-page').evaluate((canvas,tables)=>{
  const c=canvas.getContext('2d');return tables.map(t=>{const out=[];for(let y=120;y<610;y++){
   const pixels=c.getImageData(t.sampleX-3,y,7,1).data;let dark=true;
   for(let x=0;x<7;x++)if(Math.max(pixels[x*4],pixels[x*4+1],pixels[x*4+2])>=128)dark=false;
   if(!dark)continue;if(out.length&&out.at(-1)[1]===y)out.at(-1)[1]=y+1;else out.push([y,y+1]);
  }return out;});
 },ref.tables);
 await expect.poll(bands).toEqual(ref.tables.map(t=>t.bands));
 const save=async name=>{const pending=page.waitForEvent('download');await downloadDocx(page);const path=info.outputPath(name+'.docx');await(await pending).saveAs(path);return path;};
 expect(unzipSync(readFileSync(await save('noedit')))).toEqual(original);
 const text=await input.inputValue();await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');
 const edited=await save('edited'),parts=unzipSync(readFileSync(edited));
 for(const name of Object.keys(original))if(name!=='word/document.xml')expect(parts[name],name).toEqual(original[name]);
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(text);
 await expect.poll(bands).toEqual(ref.tables.map(t=>t.bands));
 expect(unzipSync(readFileSync(await save('undo')))).toEqual(original);
 await reopenDocx(page,input,edited,'Edited '+text);await expect.poll(bands).toEqual(ref.tables.map(t=>t.bands));
 expect(errors).toEqual([]);
});

test('mixed-height native 75 percent bands include the complete minimum-width bottom rule',async({page})=>{
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(root+'holdout.docx');await expect(page.locator('canvas.canvas-page')).toHaveCount(1);
 await page.getByRole('combobox',{name:'Zoom'}).selectOption('0.75');
 const ref=JSON.parse(readFileSync(root+'holdout-reference-75.json'));
 const bands=await page.locator('canvas.canvas-page').evaluate(async(canvas,tables)=>{await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const c=canvas.getContext('2d');return tables.map(t=>{const out=[];for(let y=90;y<460;y++){const pixels=c.getImageData(t.sampleX-3,y,7,1).data;let dark=true;for(let x=0;x<7;x++)if(Math.max(pixels[x*4],pixels[x*4+1],pixels[x*4+2])>=128)dark=false;if(!dark)continue;if(out.length&&out.at(-1)[1]===y)out.at(-1)[1]=y+1;else out.push([y,y+1]);}return out;});},ref.tables);
 expect(bands).toEqual(ref.tables.map(t=>t.bands));
});
