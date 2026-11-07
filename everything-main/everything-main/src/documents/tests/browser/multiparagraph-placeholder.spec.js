import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {unzipSync,strFromU8} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
const source='tests/fixtures/multiparagraph-placeholder/control.docx';

test('restores both glossary paragraphs after editing and reopening',async({page},info)=>{
 test.setTimeout(120000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});
 await expect(input).toHaveValue(/^Before filled/);await expect(input).toHaveJSProperty('readOnly',false);
 const original=await input.inputValue(),parts=unzipSync(readFileSync(source));
 const save=async name=>{const event=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await event).saveAs(path);return path;};
 expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
 await input.evaluate(el=>{const at=el.value.indexOf('First prompt');el.focus();el.setSelectionRange(at+2,at+2);el.dispatchEvent(new Event('select'));});
 await page.keyboard.insertText('Typed replacement');
 const edited=original.replace('First prompt\nSecond prompt','Typed replacement');await expect(input).toHaveValue(edited);
 const path=await save('edited');for(const[n,b]of Object.entries(parts))if(n!=='word/document.xml')expect(unzipSync(readFileSync(path))[n]).toEqual(b);
 await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(input).toHaveValue(original);expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);
 await reopenDocx(page,input,path,edited);
 await input.evaluate(el=>{const at=el.value.indexOf('Typed replacement');el.focus();el.setSelectionRange(at,at+17);el.dispatchEvent(new Event('select'));});await input.press('Backspace');
 await expect(input).toHaveValue(original);const restored=await save('restored');
 const state=await page.evaluate(xml=>{
  const w='http://schemas.openxmlformats.org/wordprocessingml/2006/main',d=new DOMParser().parseFromString(xml,'application/xml');
  const c=[...d.getElementsByTagNameNS(w,'sdt')].find(c=>c.getElementsByTagNameNS(w,'alias')[0].getAttributeNS(w,'val')==='showing');
  const ps=[...c.getElementsByTagNameNS(w,'p')];return {placeholder:!!c.getElementsByTagNameNS(w,'showingPlcHdr').length,text:ps.map(p=>p.textContent),bold:!!ps[0].getElementsByTagNameNS(w,'b').length,italic:!!ps[1].getElementsByTagNameNS(w,'i').length};
 },strFromU8(unzipSync(readFileSync(restored))['word/document.xml']));
 expect(state).toEqual({placeholder:true,text:['First prompt','Second prompt'],bold:true,italic:true});
 await reopenDocx(page,input,restored,original);await expect(input).toHaveJSProperty('readOnly',false);expect(errors).toEqual([]);
});
