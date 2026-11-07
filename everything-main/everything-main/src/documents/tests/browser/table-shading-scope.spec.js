import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';
const source='public/fixtures/table-shading-scope.docx';
const reference=JSON.parse(readFileSync('tests/fixtures/table-shading-scope/reference.json','utf8'));
test('matches native table shading scope and preserves it through editing and undo',async({page},info)=>{
  test.setTimeout(120000);
  expect(createHash('sha256').update(readFileSync(source)).digest('hex')).toBe(reference.sourceSha256);
  await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
  const input=page.getByRole('textbox',{name:'Document text'});
  await expect(input).toHaveValue(/^Direct table/);await expect(input).toHaveJSProperty('readOnly',false);
  const check=async()=>{
    await expect(page.locator('canvas.canvas-page')).toHaveCount(5);await expect(page.locator('#playground-error')).toBeEmpty();
    const colors=await page.evaluate(samples=>samples.map(s=>{
      const c=document.querySelectorAll('canvas.canvas-page')[s.page],scale=c.width/612;
      return [...c.getContext('2d').getImageData(Math.round(s.x*scale),Math.round(s.y*scale),1,1).data].slice(0,3);
    }),reference.samples);
    expect(colors).toEqual(reference.samples.map(s=>s.color));
  };
  const save=async name=>{const event=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name);await(await event).saveAs(path);return path;};
  await check();const original=await input.inputValue();await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');await check();
  const edited=await save('edited.docx');await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);await check();
  const a=unzipSync(readFileSync(source)),b=unzipSync(readFileSync(await save('undo.docx'))),e=unzipSync(readFileSync(edited));
  for(const name of Object.keys(a)){expect(Buffer.from(a[name]).equals(Buffer.from(b[name])),name).toBe(true);if(name!=='word/document.xml')expect(Buffer.from(a[name]).equals(Buffer.from(e[name])),name).toBe(true);}
  await reopenDocx(page,input,edited,'Edited '+original);await check();
});
