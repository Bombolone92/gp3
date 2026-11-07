import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { showAllTools } from './helpers/editor-tools.js';
import { reopenDocx } from './helpers/reopen-docx.js';

test('restarts a relocated numbering definition and reopens the preserved package', async ({page},info)=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/playground.html');await showAllTools(page);
  await page.getByLabel('Open DOCX file').setInputFiles('public/fixtures/numbering-location.docx');
  const input=page.getByRole('textbox',{name:'Document text'});
  await expect(input).toHaveValue('First item\nSecond item');await expect(page.locator('#playground-error')).toBeEmpty();
  await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');
  await input.press('ControlOrMeta+End');
  await page.getByRole('button',{name:'Restart numbering at 1',exact:true}).click();
  await page.locator('canvas.canvas-page').screenshot({path:info.outputPath('numbering-location.png')});
  const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();
  const saved=info.outputPath('numbering-location.docx');await(await pending).saveAs(saved);
  const before=unzipSync(readFileSync('public/fixtures/numbering-location.docx')),after=unzipSync(readFileSync(saved));
  expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
  for(const name of Object.keys(before))if(!['word/document.xml','lists/numbering2.xml'].includes(name))expect(after[name]).toEqual(before[name]);
  await reopenDocx(page,input,saved,'Edited First item\nSecond item');expect(errors).toEqual([]);
});
