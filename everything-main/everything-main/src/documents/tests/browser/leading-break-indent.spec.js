import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
const root='tests/fixtures/leading-break-indent/',reference=JSON.parse(readFileSync(root+'reference.json'));
for(const ref of reference.cases)test(`native leading-break indentation: ${ref.name}`,async({page},info)=>{
 const source=root+ref.name+'.docx',bytes=readFileSync(source),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/START Alpha beta/);await expect(input).toHaveJSProperty('readOnly',false);await expect(page.locator('canvas.canvas-page')).toHaveCount(ref.pages);
 const actual=await page.evaluate(async bytes=>{
  const {DocxPackage}=await import('/src/engine/docx.js'),{validateCanvasLayout,measureCanvasText}=await import('/src/engine/canvas-text.js');
  const {layoutDocument,caretRect}=await import('/src/engine/layout.js'),{pageGeometry}=await import('/src/engine/page-settings.js');
  const p=await DocxPackage.open(Uint8Array.from(atob(bytes),c=>c.charCodeAt(0)));await validateCanvasLayout(p);
  const ctx=document.createElement('canvas').getContext('2d'),l=layoutDocument(p.paragraphs,(t,s)=>measureCanvasText(ctx,t,s),pageGeometry(p.pageSettings),p.numbering,p.tables);
  const position=p.paragraphs.map(p=>p.runs.map(r=>r.text).join('')).join('\n').indexOf('START'),line=l.lines.find(line=>line.start<=position&&line.end>position);
  return {page:line.page,x:caretRect(l,position).x*.75,baseline:line.baseline*.75,text:line.fragments.map(f=>f.text).join('')};
 },bytes.toString('base64'));
 expect(actual.page).toBe(ref.first.page);expect(Math.abs(actual.x-ref.first.x)).toBeLessThan(.1);expect(Math.abs(actual.baseline-ref.first.baseline)).toBeLessThan(.2);expect(actual.text.trim()).toBe(ref.first.text.trim());
 writeFileSync(info.outputPath('actual.json'),JSON.stringify(actual,null,2));
 writeFileSync(info.outputPath('first-text-page.png'),Buffer.from(await page.locator('canvas.canvas-page').nth(ref.first.page).evaluate(c=>c.toDataURL().split(',')[1]),'base64'));
 const original=await input.inputValue(),position=original.indexOf('START')+6;
 await input.evaluate((el,position)=>{el.focus();el.setSelectionRange(position,position);el.dispatchEvent(new Event('select',{bubbles:true}));},position);
 await page.keyboard.insertText('Edited ');const edited=original.slice(0,position)+'Edited '+original.slice(position);await expect(input).toHaveValue(edited);
 const save=async name=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await pending).saveAs(path);return path;};
 const exported=await save('edited');for(const[name,value]of Object.entries(unzipSync(bytes)))if(name!=='word/document.xml')expect(unzipSync(readFileSync(exported))[name]).toEqual(value);
 await input.press('ControlOrMeta+z');expect(unzipSync(readFileSync(await save('undo')))).toEqual(unzipSync(bytes));
 await reopenDocx(page,input,exported,edited);await expect(input).toHaveJSProperty('readOnly',false);await expect(page.locator('canvas.canvas-page')).toHaveCount(ref.pages);expect(errors).toEqual([]);
});
