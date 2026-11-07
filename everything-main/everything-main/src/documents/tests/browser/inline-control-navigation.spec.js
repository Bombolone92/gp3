import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';
const root = 'tests/fixtures/inline-control-navigation/';
const reference = JSON.parse(readFileSync(root + 'reference.json', 'utf8'));

for (const ref of reference.cases) test(`keyboard control navigation matches the native reference: ${ref.name}`, async ({page}, info) => {
  const parts = unzipSync(readFileSync(root + ref.source)), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/playground.html'); await page.getByLabel('Open DOCX file').setInputFiles(root + ref.source);
  const input = page.getByRole('textbox', {name:'Document text'}); await expect(input).toHaveValue('ABCD');
  const save = async name => {
    const pending = page.waitForEvent('download'); await page.getByRole('button', {name:'Download .docx',exact:true}).click();
    const path = info.outputPath(name+'.docx'); await (await pending).saveAs(path); return path;
  };
  const pixels = async name => {
    const png = await page.locator('canvas.canvas-page').first().evaluate(c=>c.toDataURL());
    writeFileSync(info.outputPath(name+'.png'),Buffer.from(png.split(',')[1],'base64')); return png;
  };
  await page.getByRole('button',{name:'Download .docx',exact:true}).focus(); const before=await pixels('before');
  await input.focus(); for (const key of ref.keys) await input.press(key);
  if (ref.name==='placeholder-enter') expect(await input.evaluate(el=>[el.selectionStart,el.selectionEnd])).toEqual([1,3]);
  await pixels('focused-boundary');
  expect(unzipSync(readFileSync(await save('navigation-only')))).toEqual(parts);
  const blurred = await pixels('blurred-boundary');
  if (ref.name !== 'placeholder-enter') expect(blurred).toBe(before);
  await input.focus(); await page.keyboard.insertText('X'); await expect(input).toHaveValue(ref.text);
  const edited=await save('edited'), out=unzipSync(readFileSync(edited));
  for (const [name,data] of Object.entries(parts)) if(name!=='word/document.xml') expect(out[name]).toEqual(data);
  const control=await page.evaluate(xml=>{
    const w='http://schemas.openxmlformats.org/wordprocessingml/2006/main',d=new DOMParser().parseFromString(xml,'application/xml'),s=d.getElementsByTagNameNS(w,'sdt')[0];
    return {text:[...s.getElementsByTagNameNS(w,'t')].map(t=>t.textContent).join(''),placeholder:!!s.getElementsByTagNameNS(w,'showingPlcHdr').length};
  },strFromU8(out['word/document.xml']));
  expect(control).toEqual({text:ref.controlText,placeholder:ref.placeholder});
  await input.focus(); await input.press('ControlOrMeta+z'); await expect(input).toHaveValue('ABCD');
  expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);
  await reopenDocx(page,input,edited,ref.text); expect(errors).toEqual([]);
});

test('hidden control appearance stays hidden and modified arrow selections stay native', async ({page},info) => {
  const parts=unzipSync(readFileSync(root+'inline.docx'));
  parts['word/document.xml']=strToU8(strFromU8(parts['word/document.xml'])
    .replace('<w:document ', '<w:document xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml" mc:Ignorable="w15" ')
    .replace('<w:richText/>','<w15:appearance w15:val="hidden"/><w:richText/>'));
  await page.goto('/playground.html');
  await page.getByLabel('Open DOCX file').setInputFiles({name:'hidden.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',buffer:Buffer.from(zipSync(parts))});
  const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue('ABCD');
  await input.focus();await input.press('Control+Home');await input.press('ArrowRight');
  const pixels=()=>page.locator('canvas.canvas-page').first().evaluate(c=>c.toDataURL());
  const before=await pixels();await input.press('ArrowRight');expect(await pixels()).toBe(before);
  await input.press('Shift+ArrowRight');expect(await input.evaluate(el=>[el.selectionStart,el.selectionEnd])).toEqual([1,2]);
  await input.press('Control+Home');await input.press('Control+ArrowRight');
  expect(await input.evaluate(el=>[el.selectionStart,el.selectionEnd])).toEqual([4,4]);
  const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();
  const path=info.outputPath('hidden.docx');await(await pending).saveAs(path);expect(unzipSync(readFileSync(path))).toEqual(parts);
  await expect(page.locator('#playground-error')).toBeEmpty();
});

test('typing into a selected prompt keeps the caret inside until the next arrow',async({page},info)=>{
  const parts=unzipSync(readFileSync(root+'placeholder.docx'));
  await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(root+'placeholder.docx');
  const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue('ABCD');
  await input.focus();await input.press('Control+Home');await input.press('ArrowRight');await input.press('ArrowRight');
  await page.keyboard.insertText('X');await input.press('ArrowRight');await page.keyboard.insertText('Y');
  await expect(input).toHaveValue('AXYD');
  const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();
  const path=info.outputPath('after-prompt.docx');await(await pending).saveAs(path);
  const xml=strFromU8(unzipSync(readFileSync(path))['word/document.xml']);
  const owned=await page.evaluate(xml=>{const d=new DOMParser().parseFromString(xml,'application/xml');return [...d.getElementsByTagNameNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main','sdtContent')[0].getElementsByTagNameNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main','t')].map(t=>t.textContent).join('');},xml);
  expect(owned).toBe('X');
  await input.focus();await input.press('ControlOrMeta+z');await input.press('ControlOrMeta+z');await expect(input).toHaveValue('ABCD');
  const undo=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();
  const restored=info.outputPath('undo.docx');await(await undo).saveAs(restored);expect(unzipSync(readFileSync(restored))).toEqual(parts);
});
