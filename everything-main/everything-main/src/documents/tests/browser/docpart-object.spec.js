import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {unzipSync,strFromU8} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
import {JSDOM} from 'jsdom';
test('edits saved building-block contents while retaining their semantics',async({page},info)=>{
 const source='tests/fixtures/docpart-object/control.docx',parts=unzipSync(readFileSync(source)),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/Following paragraph$/);await expect(input).toHaveJSProperty('readOnly',false);await expect(page.locator('canvas.canvas-page')).toHaveCount(1);
 const original=await input.inputValue();
 writeFileSync(info.outputPath('page.png'),Buffer.from(await page.locator('canvas.canvas-page').evaluate(c=>c.toDataURL().split(',')[1]),'base64'));
 const save=async name=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const p=info.outputPath(name+'.docx');await(await pending).saveAs(p);return p;};
 expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
 for(const text of ['Alpha','Beta','Gamma','Delta']){
  const at=(await input.inputValue()).indexOf(text);
  await input.evaluate((e,r)=>{e.focus();e.setSelectionRange(...r);e.dispatchEvent(new Event('select',{bubbles:true}));},[at,at+text.length]);
  await page.keyboard.insertText(text+' edited');
 }
 const edited=await input.inputValue(),exported=await save('edited'),after=unzipSync(readFileSync(exported));
 for(const[n,b]of Object.entries(parts))if(n!=='word/document.xml')expect(after[n]).toEqual(b);
 const properties=xml=>{
  const dom=new JSDOM(xml,{contentType:'text/xml'}),w='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  return [...dom.window.document.getElementsByTagNameNS(w,'docPartObj')].map(e=>new dom.window.XMLSerializer().serializeToString(e));
 };
 expect(properties(strFromU8(after['word/document.xml']))).toEqual(properties(strFromU8(parts['word/document.xml'])));
 for(let i=0;i<4;i++)await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);
 expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);
 await reopenDocx(page,input,exported,edited);await expect(input).toHaveJSProperty('readOnly',false);expect(errors).toEqual([]);
});
