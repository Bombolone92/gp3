import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
const source='public/fixtures/narrow-cell-roundoff.docx';
const ref=JSON.parse(readFileSync('tests/fixtures/narrow-cell-roundoff/reference.json','utf8'));
test('renders the exact-minimum spacer like the native reference and retains editable package geometry',async({page},info)=>{
 expect(createHash('sha256').update(readFileSync(source)).digest('hex')).toBe(ref.sourceSha256);
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/Left/);await expect(input).toHaveJSProperty('readOnly',false);
 const check=async()=>{
  await expect(page.locator('canvas.canvas-page')).toHaveCount(ref.pages);await expect(page.locator('#playground-error')).toBeEmpty();
  const bounds=await page.locator('canvas.canvas-page').evaluate(c=>{const ctx=c.getContext('2d'),d=ctx.getImageData(0,0,c.width,c.height).data;let left=c.width,right=-1;for(let i=0;i<d.length;i+=4)if(d[i]===34&&d[i+1]===170&&d[i+2]===136){const x=(i/4)%c.width;left=Math.min(left,x);right=Math.max(right,x);}return {left:left*612/c.width,right:(right+1)*612/c.width};});
  expect(Math.abs(bounds.left-ref.greenLeft)).toBeLessThan(1);expect(Math.abs(bounds.right-ref.greenRight)).toBeLessThan(1);
 };
 await check();const original=await input.inputValue();
 const save=async suffix=>{const event=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(suffix+'.docx');await(await event).saveAs(path);return path;};
 const noedit=await save('noedit');await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');await check();const edited=await save('edited');
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);await check();const undo=await save('undo'),parts=unzipSync(readFileSync(source));
 for(const path of [noedit,undo])expect(unzipSync(readFileSync(path))).toEqual(parts);
 const changed=unzipSync(readFileSync(edited));for(const name of Object.keys(parts))if(name!=='word/document.xml')expect(changed[name],name).toEqual(parts[name]);
 await reopenDocx(page,input,edited,'Edited '+original);await check();
});
