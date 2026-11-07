import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
const source='tests/fixtures/body-page-fields/control.docx';
test('edits empty and multi-paragraph body fields while retaining their instructions',async({page},info)=>{
 test.setTimeout(120000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^Body page fields: section one/);await expect(input).toHaveJSProperty('readOnly',false);await expect(page.locator('canvas.canvas-page')).toHaveCount(3);
 const original=await input.inputValue(),parts=unzipSync(readFileSync(source));
 const save=async name=>{const event=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await event).saveAs(path);return path;};
 const inspect=async path=>page.evaluate(async bytes=>{
  const {DocxPackage}=await import('/src/engine/docx.js'),{bodyFieldRanges}=await import('/src/engine/body-fields.js');
  const p=await DocxPackage.open(Uint8Array.from(atob(bytes),c=>c.charCodeAt(0))),text=p.paragraphs.map(p=>p.runs.map(r=>r.text).join('')).join('\n');
  return bodyFieldRanges(p.paragraphs).map(r=>({code:r.field.instruction.trim(),text:text.slice(r.start,r.end)}));
 },readFileSync(path).toString('base64'));
 expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
 await input.evaluate(el=>{const at=el.value.indexOf('Body PAGE: [')+'Body PAGE: ['.length;el.focus();el.setSelectionRange(at,at+2);el.dispatchEvent(new Event('select'));});await input.press('Backspace');
 const emptyText=original.replace('Body PAGE: [99]','Body PAGE: []');await expect(input).toHaveValue(emptyText);
 const empty=await save('empty');expect(await inspect(empty)).toHaveLength(15);expect((await inspect(empty))[0]).toEqual({code:'PAGE',text:''});
 await reopenDocx(page,input,empty,emptyText);
 await input.evaluate(el=>{const at=el.value.indexOf('Body PAGE: [')+'Body PAGE: ['.length;el.focus();el.setSelectionRange(at,at);el.dispatchEvent(new Event('select'));});await page.keyboard.insertText('42');
 const filledText=original.replace('Body PAGE: [99]','Body PAGE: [42]');await expect(input).toHaveValue(filledText);
 await input.evaluate(el=>{const at=el.value.indexOf('Body PAGE: [')+'Body PAGE: ['.length+1;el.focus();el.setSelectionRange(at,at);el.dispatchEvent(new Event('select'));});await input.press('Enter');
 const splitText=original.replace('Body PAGE: [99]','Body PAGE: [4\n2]');await expect(input).toHaveValue(splitText);
 const split=await save('split');expect((await inspect(split))[0]).toEqual({code:'PAGE',text:'4\n2'});
 const out=unzipSync(readFileSync(split));for(const[name,bytes]of Object.entries(parts))if(name!=='word/document.xml')expect(out[name]).toEqual(bytes);
 await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(input).toHaveValue(filledText);
 await reopenDocx(page,input,split,splitText);await expect(input).toHaveJSProperty('readOnly',false);
 await input.evaluate(el=>{const at=el.value.indexOf('4\n2')+2;el.focus();el.setSelectionRange(at,at);el.dispatchEvent(new Event('select'));});await input.press('Backspace');await expect(input).toHaveValue(filledText);
 expect((await inspect(await save('joined')))[0]).toEqual({code:'PAGE',text:'42'});expect(errors).toEqual([]);
});

test('preserves a simple body field through typing and converts a paragraph split safely',async({page},info)=>{
 test.setTimeout(120000);
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^Body page fields: section one/);
 const ranges=await page.evaluate(async bytes=>{
  const {DocxPackage}=await import('/src/engine/docx.js'),{bodyFieldRanges}=await import('/src/engine/body-fields.js');
  return bodyFieldRanges((await DocxPackage.open(Uint8Array.from(atob(bytes),c=>c.charCodeAt(0)))).paragraphs).map(r=>({start:r.start,end:r.end}));
 },readFileSync(source).toString('base64'));
 const r=ranges[2],original=await input.inputValue();
 const select=async(a,b=a)=>input.evaluate((el,{a,b})=>{el.focus();el.setSelectionRange(a,b);el.dispatchEvent(new Event('select'));},{a,b});
 const save=async name=>{const event=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await event).saveAs(path);return path;};
 await select(r.start,r.end);await page.keyboard.insertText('42');
 const edited=original.slice(0,r.start)+'42'+original.slice(r.end);await expect(input).toHaveValue(edited);
 const simple=await save('simple-edited');
 expect(new TextDecoder().decode(unzipSync(readFileSync(simple))['word/document.xml']).match(/<w:fldSimple\b/g)).toHaveLength(4);
 await reopenDocx(page,input,simple,edited);await expect(input).toHaveJSProperty('readOnly',false);
 await select(r.start+1);await input.press('Enter');
 const split=edited.slice(0,r.start+1)+'\n'+edited.slice(r.start+1);await expect(input).toHaveValue(split);
 const output=await save('simple-split');await reopenDocx(page,input,output,split);await expect(input).toHaveJSProperty('readOnly',false);
 const result=await page.evaluate(async bytes=>{
  const {DocxPackage}=await import('/src/engine/docx.js'),{bodyFieldRanges}=await import('/src/engine/body-fields.js');
  const p=await DocxPackage.open(Uint8Array.from(atob(bytes),c=>c.charCodeAt(0))),rs=bodyFieldRanges(p.paragraphs),text=p.paragraphs.map(p=>p.runs.map(r=>r.text).join('')).join('\n');
  return {count:rs.length,instruction:rs[2].field.instruction.trim(),result:text.slice(rs[2].start,rs[2].end)};
 },readFileSync(output).toString('base64'));
 expect(result).toEqual({count:15,instruction:'NUMPAGES',result:'4\n2'});
});
