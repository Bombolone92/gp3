import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';
import { showAllTools } from './helpers/editor-tools.js';

for (const location of ['body','cell','table','nested','mixed']) test(`edits and reopens ${location} block controls`,async({page},info)=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/playground.html');
  await page.getByLabel('Open DOCX file').setInputFiles(`public/fixtures/block-control-${location}.docx`);
  const input=page.getByRole('textbox',{name:'Document text'});
  await expect.poll(()=>input.inputValue()).toContain('Control alpha');
  const original=await input.inputValue();
  await input.evaluate(el=>{const at=el.value.indexOf('Control alpha');el.focus();el.setSelectionRange(at,at+7);el.dispatchEvent(new Event('select'));});
  await page.getByRole('button',{name:'Bold',exact:true}).click();
  const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();
  const formatted=info.outputPath(`block-${location}-formatted.docx`);await(await pending).saveAs(formatted);
  const xml=strFromU8(unzipSync(readFileSync(formatted))['word/document.xml']);
  expect(xml).toContain('w:val="41"');
  await reopenDocx(page,input,formatted,original);
  await input.evaluate(el=>{const at=el.value.indexOf('Control alpha')+2;el.focus();el.setSelectionRange(at,at);el.dispatchEvent(new Event('select'));});
  await input.pressSequentially('X');
  await expect(input).toHaveValue(original.replace('Control alpha','CoXntrol alpha'));
  const editedPending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();
  const edited=info.outputPath(`block-${location}-edited.docx`);await(await editedPending).saveAs(edited);
  expect(strFromU8(unzipSync(readFileSync(edited))['word/document.xml'])).not.toContain('w:val="41"');
  await reopenDocx(page,input,edited,original.replace('Control alpha','CoXntrol alpha'));
  expect(errors).toEqual([]);
});

for (const location of ['table','cellonly']) test(`retains the correct wrappers when adding a row in ${location}`,async({page},info)=>{
  await page.goto('/playground.html');
  await showAllTools(page);
  await page.getByLabel('Open DOCX file').setInputFiles(`public/fixtures/block-control-${location}.docx`);
  const input=page.getByRole('textbox',{name:'Document text'});
  await expect.poll(()=>input.inputValue()).toContain('Control alpha');
  await input.evaluate((el,text)=>{const at=el.value.indexOf(text);el.focus();el.setSelectionRange(at,at);el.dispatchEvent(new Event('select'));},location==='table'?'Control beta':'Control alpha');
  await page.getByRole('combobox',{name:'Table actions',exact:true}).selectOption('addRow');
  const text=await input.inputValue(),pending=page.waitForEvent('download');
  await page.getByRole('button',{name:'Download .docx',exact:true}).click();
  const path=info.outputPath(`block-${location}-row.docx`);await(await pending).saveAs(path);
  const xml=strFromU8(unzipSync(readFileSync(path))['word/document.xml']);
  expect(xml.match(/<w:tr(?:\s|>)/g)).toHaveLength(2);
  expect(xml.match(/<w:sdt(?:\s|>)/g)||[]).toHaveLength(location==='table'?0:1);
  await reopenDocx(page,input,path,text);
});
