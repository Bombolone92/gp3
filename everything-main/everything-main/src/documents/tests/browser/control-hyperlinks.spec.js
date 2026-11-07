import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {unzipSync,strFromU8} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
const choose=async(input,text)=>input.evaluate((el,text)=>{const at=el.value.indexOf(text);el.focus();el.setSelectionRange(at,at+text.length);el.dispatchEvent(new Event('select'));},text);
const download=async(page,info,name)=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name);await(await pending).saveAs(path);return path;};
test('formats links within controls, reopens their nested structure and edits a destination with undo',async({page},info)=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles('public/fixtures/control-hyperlinks.docx');
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^Links inside controls/);await expect(input).toHaveJSProperty('readOnly',false);const original=await input.inputValue();
 await choose(input,'Mail');await input.press('ControlOrMeta+b');await page.getByLabel('Font size (pt)').fill('15');await page.getByLabel('Font size (pt)').press('Tab');
 const saved=await download(page,info,'control-hyperlinks.docx');await reopenDocx(page,input,saved,original);
 await choose(input,'Mail');await expect(page.getByRole('button',{name:'Bold',exact:true})).toHaveAttribute('aria-pressed','true');await expect(page.getByLabel('Font size (pt)')).toHaveValue('15');
 writeFileSync(info.outputPath('control-hyperlinks.png'),Buffer.from(await page.locator('canvas.canvas-page').first().evaluate(c=>c.toDataURL().split(',')[1]),'base64'));
 await input.press('ControlOrMeta+k');await expect(page.getByRole('textbox',{name:'Link address',exact:true})).toHaveValue('mailto:hello@example.com');
 await page.getByRole('textbox',{name:'Link address',exact:true}).fill('https://example.com/changed');await page.getByRole('dialog').getByRole('button',{name:'Apply',exact:true}).click();
 const changed=unzipSync(readFileSync(await download(page,info,'control-hyperlinks-target.docx')));expect(strFromU8(changed['word/document.xml']).match(/<w:sdt(?:\s|>)/g)).toHaveLength(2);
 await page.getByRole('button',{name:'Undo',exact:true}).click();const restored=unzipSync(readFileSync(await download(page,info,'control-hyperlinks-restored.docx'))),before=unzipSync(readFileSync(saved));
 for(const n of Object.keys(before))expect(Buffer.from(restored[n]).equals(Buffer.from(before[n])),n).toBe(true);
 // Existing clipboard contract transfers source text, not rich hyperlinks.
 await choose(input,'Mail á😀');const copied=await input.evaluate(el=>{const data=new DataTransfer();el.dispatchEvent(new ClipboardEvent('copy',{bubbles:true,cancelable:true,clipboardData:data}));return data.getData('text/plain');});expect(copied).toBe('Mail á😀');
 await input.press('ControlOrMeta+End');await input.evaluate(el=>{const data=new DataTransfer();data.setData('text/plain',' Pasted Á😀');el.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));});await expect(input).toHaveValue(original+' Pasted Á😀');
 expect(errors).toEqual([]);
});
