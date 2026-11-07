import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';

test('edits original RTL DOCX, commits composition once and preserves source parts through undo',async({page},info)=>{
 const source='tests/fixtures/rtl-font-context/control.docx',errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^Case 1:/);await expect(input).toHaveJSProperty('readOnly',false);
 const original=await input.inputValue();expect(original).toContain('אבג');expect(original).toContain('مرحبا');
 const download=async name=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name);await(await pending).saveAs(path);return path;};
 const parts=unzipSync(readFileSync(source));expect(unzipSync(readFileSync(await download('original.docx')))).toEqual(parts);
 const at=original.indexOf('مرحبا')+1;
 await input.evaluate((el,at)=>{el.focus();el.setSelectionRange(at,at);el.dispatchEvent(new Event('select',{bubbles:true}));},at);
 // Synthetic native-event sequence tests editor composition handling; it is
 // not a recording of an OS input method or a reference-application keyboard interaction.
 await input.evaluate((el,{original,at})=>{
  el.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));
  for(const data of ['ا','اب']){el.value=original.slice(0,at)+data+original.slice(at);el.setSelectionRange(at+data.length,at+data.length);el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertCompositionText',data,isComposing:true}));}
  el.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'اب'}));
 },{original,at});
 const changed=original.slice(0,at)+'اب'+original.slice(at);await expect(input).toHaveValue(changed);
 const edited=await download('composed.docx'),editedParts=unzipSync(readFileSync(edited));
 for(const [name,bytes]of Object.entries(parts))if(name!=='word/document.xml')expect(editedParts[name],name).toEqual(bytes);
 await input.press('Control+z');await expect(input).toHaveValue(original);expect(unzipSync(readFileSync(await download('undo.docx')))).toEqual(parts);
 await input.press('Control+y');await expect(input).toHaveValue(changed);
 await reopenDocx(page,input,edited,changed);await expect(input).toHaveJSProperty('readOnly',false);
 expect(errors).toEqual([]);
});
