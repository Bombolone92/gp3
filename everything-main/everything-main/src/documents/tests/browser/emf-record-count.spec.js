import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
test('renders high-record-count EMFs identically and preserves editable exports',async({page},info)=>{
 await page.goto('/playground.html');
 const input=page.getByRole('textbox',{name:'Document text'}),canvas=page.locator('canvas.canvas-page');
 await page.getByLabel('Open DOCX file').setInputFiles('public/fixtures/emf-paths-float-miter.docx');
 await expect(input).toHaveValue(/^Shape defaults/);await expect(canvas).toHaveCount(1);
 await page.evaluate(()=>document.fonts.ready);await input.blur();
 const pixels=()=>canvas.evaluate(c=>c.toDataURL());const baseline=await pixels();
 const source='tests/fixtures/emf-record-count/control.docx',original=await input.inputValue();
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);await expect(input).toHaveValue(original);await input.blur();
 await expect.poll(pixels).toBe(baseline);await expect(input).toBeEditable();
 const save=async name=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await pending).saveAs(path);return path;};
 const parts=unzipSync(readFileSync(source));expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
 await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');const text=await input.inputValue(),edited=await save('edited');
 for(const[n,b]of Object.entries(unzipSync(readFileSync(edited))))if(n!=='word/document.xml')expect(b).toEqual(parts[n]);
 await input.press('ControlOrMeta+z');expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);
 await reopenDocx(page,input,edited,text);await expect(input).toBeEditable();await expect(canvas).toHaveCount(1);
});

