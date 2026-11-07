import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';

test('retains a temporary rich-text wrapper through partial formatting and a DOCX round trip', async ({ page }, info) => {
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/playground.html');
  await page.getByLabel('Open DOCX file').setInputFiles('public/fixtures/temporary-control-formatting.docx');
  const input=page.getByRole('textbox',{name:'Document text'});
  await expect(input).toHaveValue('Before block\nControl alpha\nAfter block');
  const original=await input.inputValue();
  await input.evaluate(el=>{const at=el.value.indexOf('Control');el.focus();el.setSelectionRange(at,at+7);el.dispatchEvent(new Event('select'));});
  await page.getByRole('button',{name:'Bold',exact:true}).click();
  const pending=page.waitForEvent('download');
  await page.getByRole('button',{name:'Download .docx',exact:true}).click();
  const path=info.outputPath('temporary-control-formatting.docx');await(await pending).saveAs(path);
  const xml=strFromU8(unzipSync(readFileSync(path))['word/document.xml']);
  expect(xml.match(/<w:sdt(?:\s|>)/g)).toHaveLength(1);
  expect(xml).toContain('w:val="41"');expect(xml).toContain('<w:temporary');
  await reopenDocx(page,input,path,original);
  await input.evaluate(el=>{const at=el.value.indexOf('Control');el.focus();el.setSelectionRange(at,at+7);el.dispatchEvent(new Event('select'));});
  await expect(page.getByRole('button',{name:'Bold',exact:true})).toHaveAttribute('aria-pressed','true');
  await input.evaluate(el=>{const at=el.value.indexOf('alpha');el.focus();el.setSelectionRange(at,at+5);el.dispatchEvent(new Event('select'));});
  await expect(page.getByRole('button',{name:'Bold',exact:true})).toHaveAttribute('aria-pressed','false');
  expect(errors).toEqual([]);
});
