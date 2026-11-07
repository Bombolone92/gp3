import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {unzipSync,strFromU8} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
test('edits a nested block placeholder without flattening its outer wrapper',async({page},info)=>{
 const source='tests/fixtures/nested-persistent-blocks/control.docx',parts=unzipSync(readFileSync(source)),errors=[];
 page.on('pageerror',e=>errors.push(e.message));await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/After temporary-outer$/);await expect(input).toHaveJSProperty('readOnly',false);await expect(page.locator('canvas.canvas-page')).toHaveCount(2);
 const original=await input.inputValue(),at=original.indexOf('Alpha beta');
 const select=async(a,b)=>input.evaluate((e,r)=>{e.focus();e.setSelectionRange(...r);e.dispatchEvent(new Event('select',{bubbles:true}));},[a,b]);
 const save=async name=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await pending).saveAs(path);return path;};
 expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
 await select(at,at+10);await input.press('Backspace');await expect(input).toHaveValue(original.slice(0,at)+'     '+original.slice(at+10));
 const check=path=>{
  const bytes=unzipSync(readFileSync(path));for(const[n,b]of Object.entries(parts))if(n!=='word/document.xml')expect(bytes[n]).toEqual(b);
  const dom=new JSDOM(strFromU8(bytes['word/document.xml']),{contentType:'text/xml'}),w='http://schemas.openxmlformats.org/wordprocessingml/2006/main',controls=[...dom.window.document.getElementsByTagNameNS(w,'sdt')];
  expect(controls).toHaveLength(14);expect(controls[1].parentElement.parentElement).toBe(controls[0]);
  const inner=controls[1].firstElementChild,outer=controls[0].firstElementChild;
  expect(outer.getElementsByTagNameNS(w,'showingPlcHdr')).toHaveLength(0);return {dom,inner};
 };
 const empty=check(await save('placeholder'));expect(empty.inner.getElementsByTagNameNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main','showingPlcHdr')).toHaveLength(1);empty.dom.window.close();
 await select(at+2,at+2);await page.keyboard.insertText('Entered');const edited=await input.inputValue();expect(edited).toBe(original.slice(0,at)+'Entered'+original.slice(at+10));
 const exported=await save('edited'),filled=check(exported);expect(filled.inner.getElementsByTagNameNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main','showingPlcHdr')).toHaveLength(0);filled.dom.window.close();
 await input.press('ControlOrMeta+z');await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);
 await reopenDocx(page,input,exported,edited);await expect(input).toHaveJSProperty('readOnly',false);expect(errors).toEqual([]);
});
