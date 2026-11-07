import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
const source='tests/fixtures/nested-page-fields/control.docx';
for(const label of ['complex/complex','complex/simple','simple/complex','simple/simple','empty-start','empty-end','all-empty'])
test(`nested ${label}: type, split, export, reopen and exact undo`,async({page},info)=>{
 test.setTimeout(180000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^Nested field result controls/);await expect(input).toHaveJSProperty('readOnly',false);await expect(page.locator('canvas.canvas-page')).toHaveCount(1);
 const original=await input.inputValue(),parts=unzipSync(readFileSync(source));
 const at=original.indexOf(label+': [')+(label+': [').length+(label==='empty-start'||label==='all-empty'?0:1);
 const save=async name=>{const event=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await event).saveAs(path);return path;};
 const select=async(a,b=a)=>input.evaluate((el,{a,b})=>{el.focus();el.setSelectionRange(a,b);el.dispatchEvent(new Event('select'));},{a,b});
 expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
 await select(at,label.startsWith('empty')||label==='all-empty'?at:at+2);await page.keyboard.insertText('Filled');
 const filled=original.slice(0,at)+'Filled'+original.slice(label.startsWith('empty')||label==='all-empty'?at:at+2);await expect(input).toHaveValue(filled);
 await select(at+3);await input.press('Enter');const split=filled.slice(0,at+3)+'\n'+filled.slice(at+3);await expect(input).toHaveValue(split);
 const path=await save('split');const output=unzipSync(readFileSync(path));
 for(const[name,bytes]of Object.entries(parts))if(name!=='word/document.xml')expect(output[name]).toEqual(bytes);
 const ranges=await page.evaluate(async bytes=>{
  const {DocxPackage}=await import('/src/engine/docx.js'),{bodyFieldRanges}=await import('/src/engine/body-fields.js');
  const p=await DocxPackage.open(Uint8Array.from(atob(bytes),c=>c.charCodeAt(0))),text=p.paragraphs.map(p=>p.runs.map(r=>r.text).join('')).join('\n');
  return bodyFieldRanges(p.paragraphs).map(r=>({code:r.field.instruction,result:text.slice(r.start,r.end)}));
 },readFileSync(path).toString('base64'));
 expect(ranges).toHaveLength(17);expect(ranges.filter(r=>r.result.includes('Fil\nled'))).toHaveLength(label==='all-empty'?3:2);
 await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(input).toHaveValue(filled);
 await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(input).toHaveValue(original);expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);
 await reopenDocx(page,input,path,split);await expect(input).toHaveJSProperty('readOnly',false);expect(errors).toEqual([]);
});
