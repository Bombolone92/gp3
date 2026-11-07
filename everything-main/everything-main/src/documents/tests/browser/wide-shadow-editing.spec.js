import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
import {expectBodyEditParts} from './helpers/expect-body-edit-parts.js';

test.use({deviceScaleFactor:4});
test('wide shadow density survives high-DPI edit, undo and reopening',async({page},info)=>{
  test.setTimeout(120000);
  const root='tests/fixtures/shadow-blur-profile/',source=root+'source.docx';
  const ref=JSON.parse(readFileSync(root+'reference.json')),parts=unzipSync(readFileSync(source));
  await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
  const input=page.getByRole('textbox',{name:'Document text'});
  await expect(input).toHaveValue(/^square-72-blur-0/);await expect(input).toHaveJSProperty('readOnly',false);
  const original=await input.inputValue();
  const check=async()=>{
    const canvas=page.locator('canvas.canvas-page').nth(5);
    const errors=await canvas.evaluate((c,p)=>{
      const scale=c.width/612,ctx=c.getContext('2d');
      return p.samples.flatMap(([x,y,lo,hi])=>{
        const a=Array.from(ctx.getImageData(Math.round(x*scale),Math.round(y*scale),1,1).data).slice(0,3);
        return a.some(v=>v<lo-4||v>hi+4)?[{x,y,lo,hi,actual:a}]:[];
      });
    },ref.pages[5]);
    expect(errors).toEqual([]);
  };
  const save=async name=>{
    const event=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();
    const path=info.outputPath(name+'.docx');await(await event).saveAs(path);return path;
  };
  await check();expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
  await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');
  const edited=await save('edited'),after=unzipSync(readFileSync(edited));
  expectBodyEditParts(after,parts);
  await check();await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);
  expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);await check();
  await reopenDocx(page,input,edited,'Edited '+original);await expect(input).toHaveJSProperty('readOnly',false);await check();
});
