import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
const select=async(input,a,b=a)=>input.evaluate((el,[a,b])=>{el.focus();el.setSelectionRange(a,b);el.dispatchEvent(new Event('select',{bubbles:true}));},[a,b]);
const pixels=page=>page.locator('canvas.canvas-page').evaluateAll(async canvases=>Promise.all(canvases.map(async c=>({width:c.width,height:c.height,hash:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',c.getContext('2d').getImageData(0,0,c.width,c.height).data))).map(b=>b.toString(16).padStart(2,'0')).join('')}))));
for(const fixture of ['toggle-body','toggle-cell','body'])test(`native ${fixture} paragraph mark governs Enter, undo and reopen`,async({page},info)=>{
 test.setTimeout(120000);const source=`tests/fixtures/paragraph-end-typing/${fixture}.docx`,errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/playground.html');const input=page.getByRole('textbox',{name:'Document text',exact:true}),previous=await input.elementHandle();
 await page.getByLabel('Open DOCX file').setInputFiles(source);await expect.poll(()=>previous.evaluate(e=>e.isConnected)).toBe(false);await previous.dispose();
 await expect(input).toHaveJSProperty('readOnly',false);const original=await input.inputValue();await input.evaluate(el=>el.blur());const before=await pixels(page);
 if(fixture!=='body'){await select(input,0,11);await page.getByRole('button',{name:'Bold',exact:true}).click();await input.press('ArrowRight');}
 else await select(input,17);
 await input.press('Enter');await page.keyboard.insertText('Added paragraph');const text=await input.inputValue();expect(text).toContain('\nAdded paragraph');
 const at=text.indexOf('Added paragraph');await select(input,at,at+15);
 await expect(page.getByRole('button',{name:'Bold',exact:true})).toHaveAttribute('aria-pressed',fixture==='body'?'false':'true');
 await expect(page.getByRole('button',{name:'Italic',exact:true})).toHaveAttribute('aria-pressed',fixture==='body'?'false':'true');
 await select(input,0);await input.evaluate(el=>el.blur());const editedPixels=await pixels(page);
 const download=async name=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name);await(await pending).saveAs(path);return path;};
 const exported=await download('edited.docx'),parts=unzipSync(readFileSync(exported)),originalParts=unzipSync(readFileSync(source));
 for(const[name,bytes]of Object.entries(originalParts))if(name!=='word/document.xml')expect(parts[name],name).toEqual(bytes);
 const steps=fixture==='body'?2:3;for(let i=0;i<steps;i++)await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);
 await expect(input).toHaveJSProperty('selectionStart',fixture==='body'?17:0);await expect(input).toHaveJSProperty('selectionEnd',fixture==='body'?17:11);
 await select(input,0);await input.evaluate(el=>el.blur());expect(await pixels(page)).toEqual(before);expect(unzipSync(readFileSync(await download('undo.docx')))).toEqual(originalParts);
 for(let i=0;i<steps;i++)await input.press('ControlOrMeta+Shift+z');await expect(input).toHaveValue(text);
 await select(input,0);await input.evaluate(el=>el.blur());expect(await pixels(page)).toEqual(editedPixels);await reopenDocx(page,input,exported,text);
 await select(input,at,at+15);await expect(page.getByRole('button',{name:'Bold',exact:true})).toHaveAttribute('aria-pressed',fixture==='body'?'false':'true');
 await select(input,0);await input.evaluate(el=>el.blur());expect(await pixels(page)).toEqual(editedPixels);expect(errors).toEqual([]);await expect(page.locator('#playground-error')).toBeEmpty();
});
