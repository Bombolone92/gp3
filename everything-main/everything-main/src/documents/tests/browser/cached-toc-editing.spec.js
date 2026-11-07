import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
for(const fixture of ['toc-pageref','toc-pageref-formatting','toc-hyperlink-style'])
test(`edits cached TOC labels and nested references without flattening ${fixture}`,async({page},info)=>{
 test.setTimeout(180000);const source=`public/fixtures/${fixture}.docx`,parts=unzipSync(readFileSync(source));
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^Nested table of contents control/);await expect(input).toHaveJSProperty('readOnly',false);await expect(page.locator('canvas.canvas-page')).toHaveCount(4);
 const original=await input.inputValue(),at=original.indexOf('First topic');
 const select=async(a,b=a)=>input.evaluate((el,{a,b})=>{el.focus();el.setSelectionRange(a,b);el.dispatchEvent(new Event('select'));},{a,b});
 const save=async name=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await pending).saveAs(path);return path;};
 await select(at,at+11);await page.keyboard.insertText('Manual entry');
 const entry=original.slice(0,at)+'Manual entry'+original.slice(at+11);await expect(input).toHaveValue(entry);
 const number=at+'Manual entry\t'.length;await select(number,number+1);await input.press('Backspace');
 const empty=entry.slice(0,number)+entry.slice(number+1);await expect(input).toHaveValue(empty);await save('empty-reference');
 await page.keyboard.insertText('9');const filled=empty.slice(0,number)+'9'+empty.slice(number);await expect(input).toHaveValue(filled);
 await select(at+6);await input.press('Enter');const split=filled.slice(0,at+6)+'\n'+filled.slice(at+6);await expect(input).toHaveValue(split);
 const output=await save('edited'),out=unzipSync(readFileSync(output));
 for(const[name,bytes]of Object.entries(parts))if(name!=='word/document.xml')expect(out[name]).toEqual(bytes);
 const fields=await page.evaluate(async bytes=>{
  const {DocxPackage}=await import('/src/engine/docx.js'),{bodyFieldRanges}=await import('/src/engine/body-fields.js');
  const p=await DocxPackage.open(Uint8Array.from(atob(bytes),c=>c.charCodeAt(0))),text=p.paragraphs.map(p=>p.runs.map(r=>r.text).join('')).join('\n');
  return bodyFieldRanges(p.paragraphs).map(r=>({type:r.field.type,instruction:r.field.instruction,result:text.slice(r.start,r.end),startLink:r.startLink?.anchor,endLink:r.endLink?.anchor}));
 },readFileSync(output).toString('base64'));
 expect(fields).toHaveLength(5);expect(fields[0]).toMatchObject({type:'TOC',result:'Manual\n entry\t9\nSecond topic\t3\nThird topic\t4'});
 expect(fields[1]).toMatchObject({type:'PAGEREF',result:'9',startLink:'Topic1',endLink:'Topic1'});
 for(let i=0;i<4;i++)await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(input).toHaveValue(original);expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);
 await reopenDocx(page,input,output,split);await expect(input).toHaveJSProperty('readOnly',false);await expect(page.locator('canvas.canvas-page')).toHaveCount(4);expect(errors).toEqual([]);
});
