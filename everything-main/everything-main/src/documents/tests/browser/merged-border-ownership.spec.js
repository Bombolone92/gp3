import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
import {expectBodyEditParts} from './helpers/expect-body-edit-parts.js';
const root='tests/fixtures/merged-border-ownership/',source=root+'controls.docx',bytes=readFileSync(source),ref=JSON.parse(readFileSync(root+'reference.json'));
test.use({deviceScaleFactor:3});
test('matches native merged border ownership and hidden row reserves through editing',async({page},info)=>{
 test.setTimeout(120000);
 expect(createHash('sha256').update(bytes).digest('hex')).toBe(ref.sourceSha256);
 await page.goto('/playground.html');
 const available=await page.evaluate(async()=>{const{checkFontAvailability,fontAvailable}=await import('/src/engine/font-availability.js');await checkFontAvailability('Arial');return fontAvailable('Arial');});
 test.skip(!available,'Native row geometry requires installed Arial.');
 await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^baseline/);await expect(input).toHaveJSProperty('readOnly',false);
 const check=async()=>{
  await expect(page.locator('canvas.canvas-page')).toHaveCount(10);
  const results=await page.evaluate(async({data,cases})=>{
   const {DocxPackage}=await import('/src/engine/docx.js'),{measureCanvasText,loadCanvasFonts}=await import('/src/engine/canvas-text.js'),{layoutDocument}=await import('/src/engine/layout.js'),{pageGeometry}=await import('/src/engine/page-settings.js');
   const p=await DocxPackage.open(Uint8Array.from(atob(data),c=>c.charCodeAt(0)));await loadCanvasFonts(p);const ctx=document.createElement('canvas').getContext('2d');
   const layout=layoutDocument(p.paragraphs,(t,s)=>measureCanvasText(ctx,t,s),pageGeometry(p.pageSettings),p.numbering,p.tables);
   return cases.map((c,index)=>{
    const canvas=document.querySelectorAll('canvas.canvas-page')[index],paint=canvas.getContext('2d'),scale=canvas.width/612;
    return {lines:layout.lines.filter(l=>l.page===index).map(l=>({text:l.fragments.map(f=>f.text).join(''),x:l.fragments[0]?.x*.75,y:l.baseline*.75})),ink:c.samples.map(s=>{const rgb=Array.from(paint.getImageData(Math.round(s.x*scale),Math.round(s.y*scale),1,1).data).slice(0,3);return Math.max(...rgb)-Math.min(...rgb)>40;})};
   });
  },{data:bytes.toString('base64'),cases:ref.cases});
  for(const [i,c] of ref.cases.entries()){
   expect(results[i].ink,c.name+' visible borders').toEqual(c.samples.map(s=>s.ink));
   for(const n of c.texts){const a=results[i].lines.find(l=>l.text===n.text);expect(a).toBeTruthy();expect(Math.abs(a.x-n.x),c.name+' '+n.text+' x').toBeLessThan(.2);expect(Math.abs(a.y-n.y),c.name+' '+n.text+' y').toBeLessThan(.2);}
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
