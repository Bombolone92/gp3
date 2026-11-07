import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';
const reference=JSON.parse(readFileSync('tests/fixtures/empty-section-boundary/reference.json','utf8'));
test('matches native section pages and restores pagination after boundary edits',async({page},info)=>{
 test.setTimeout(90000);
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles('public/fixtures/empty-section-boundary.docx');
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^empty\n/);await expect(input).toHaveJSProperty('readOnly',false);
 const original=await input.inputValue();await expect(page.locator('canvas.canvas-page')).toHaveCount(reference.pages.length);
 for(const {page:pageNumber,text} of reference.pages.filter(p=>/^(roomy-)?(border|shading)$/.test(p.text))){
  const colored=await page.locator('canvas.canvas-page').nth(pageNumber-1).evaluate(c=>{
   const pixels=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
   for(let i=0;i<pixels.length;i+=4)if(pixels[i]-Math.min(pixels[i+1],pixels[i+2])>10)return true;
   return false;
  });expect(colored,text+' suppresses decoration').toBe(false);
 }
 // The empty break follows the table's text and an ordinary empty paragraph.
 await input.focus();await input.evaluate(el=>{const at=el.value.indexOf('After empty')-1;el.setSelectionRange(at,at);el.dispatchEvent(new Event('select',{bubbles:true}));});
 await page.keyboard.insertText('Typed boundary');await expect(page.locator('canvas.canvas-page')).toHaveCount(reference.pages.length+1);
 const editedText=await input.inputValue();
 const download=async suffix=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(`empty-section-${suffix}.docx`);await(await pending).saveAs(path);return path;};
 const edited=await download('edited'),source=unzipSync(readFileSync('public/fixtures/empty-section-boundary.docx')),saved=unzipSync(readFileSync(edited));
 for(const name of Object.keys(source))if(name!=='word/document.xml')expect(saved[name]).toEqual(source[name]);
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);await expect(page.locator('canvas.canvas-page')).toHaveCount(reference.pages.length);
 expect(unzipSync(readFileSync(await download('undo')))).toEqual(source);
 await reopenDocx(page,input,edited,editedText);await expect(page.locator('canvas.canvas-page')).toHaveCount(reference.pages.length+1);
 await expect(page.locator('#playground-error')).toBeEmpty();
});
