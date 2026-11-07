import {test, expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {unzipSync, strFromU8} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';

test('edits a persistent placeholder, retains its wrapper, and restores the original on undo', async ({page},info) => {
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  const source='public/fixtures/persistent-inline-controls.docx';
  await page.goto('/playground.html'); await page.getByLabel('Open DOCX file').setInputFiles(source);
  const input=page.getByRole('textbox',{name:'Document text'});
  await expect(input).toHaveValue(/^insert: before Alpha beta/);
  const original=await input.inputValue();
  await input.evaluate(el=>{
    const start=el.value.indexOf('placeholder: before ')+ 'placeholder: before '.length;
    el.focus();el.setSelectionRange(start+2,start+2);el.dispatchEvent(new Event('select'));
  });
  await page.keyboard.insertText('Entered');
  const edited=original.replace('placeholder: before Alpha beta after','placeholder: before Entered after');
  await expect(input).toHaveValue(edited);
  const download=async name=>{
    const pending=page.waitForEvent('download'); await page.getByRole('button',{name:'Download .docx',exact:true}).click();
    const path=info.outputPath(name);await(await pending).saveAs(path);return path;
  };
  const path=await download('persistent-edited.docx'), parts=unzipSync(readFileSync(path));
  expect(strFromU8(parts['word/document.xml']).match(/<w:sdt(?:\s|>)/g)).toHaveLength(10);
  await page.getByRole('button',{name:'Undo',exact:true}).click(); await expect(input).toHaveValue(original);
  const undoParts=unzipSync(readFileSync(await download('persistent-undo.docx'))), originalParts=unzipSync(readFileSync(source));
  expect(Object.keys(undoParts).sort()).toEqual(Object.keys(originalParts).sort());
  for(const[name,bytes]of Object.entries(originalParts))expect(Buffer.from(undoParts[name]).equals(Buffer.from(bytes)),name).toBe(true);
  await reopenDocx(page,input,path,edited);
  await input.evaluate(el=>{const at=el.value.indexOf('Entered');el.focus();el.setSelectionRange(at,at+7);el.dispatchEvent(new Event('select'));});
  await input.press('Backspace');
  await expect(input).toHaveValue(edited.replace('Entered',''));
  // An empty control is kept until the caret leaves it (native selected
  // deletion references live in fixtures/outside-control-delete).
  await input.press('ArrowRight');
  await expect(input).toHaveValue(edited.replace('Entered','     '));
  const restored=await download('persistent-restored-placeholder.docx');
  expect(strFromU8(unzipSync(readFileSync(restored))['word/document.xml'])).toContain('showingPlcHdr');
  expect(errors).toEqual([]);
});

test('restores a glossary placeholder after a browser edit and reopen', async ({page},info) => {
  await page.goto('/playground.html');
  await page.getByLabel('Open DOCX file').setInputFiles('public/fixtures/persistent-inline-glossary.docx');
  const input=page.getByRole('textbox',{name:'Document text'});
  await expect(input).toHaveValue(/^insert: before Alpha beta/);
  const select=async text=>input.evaluate((el,text)=>{const at=el.value.indexOf(text);el.focus();el.setSelectionRange(at,at+text.length);el.dispatchEvent(new Event('select'));},text);
  const download=async name=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name);await(await pending).saveAs(path);return path;};
  await select('Alpha beta');await page.keyboard.insertText('A name');
  const edited=await input.inputValue(), path=await download('persistent-glossary-edited.docx');
  await reopenDocx(page,input,path,edited);await select('A name');await input.press('Backspace');
  await expect(input).toHaveValue(edited.replace('A name',''));
  await input.press('ArrowRight');
  await expect(input).toHaveValue(edited.replace('A name','Enter name'));
  const restored=await download('persistent-glossary-restored.docx');
  await reopenDocx(page,input,restored,edited.replace('A name','Enter name'));await select('Enter name');
  await expect(page.getByRole('button',{name:'Bold',exact:true})).toHaveAttribute('aria-pressed','true');
});

test('restores multiline glossary text without splitting its paragraph or losing its wrapper', async ({page},info) => {
  const source='public/fixtures/placeholder-breaks.docx';
  await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
  const input=page.getByRole('textbox',{name:'Document text'});
  await expect(input).toHaveValue(/^insert: before Alpha beta/);
  const original=await input.inputValue();
  const select=async text=>input.evaluate((el,text)=>{const at=el.value.indexOf(text);el.focus();el.setSelectionRange(at,at+text.length);el.dispatchEvent(new Event('select'));},text);
  const download=async name=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name);await(await pending).saveAs(path);return path;};
  await select('Alpha beta');await input.press('Backspace');
  await expect(input).toHaveValue(original.replace('Alpha beta',''));
  await input.press('ArrowRight');
  // The accessible textarea represents manual line breaks as newlines. The
  // package assertion below distinguishes them from paragraph splits.
  const restored=original.replace('Alpha beta','First line\nSecond line\nThird line');
  await expect(input).toHaveValue(restored);
  const path=await download('placeholder-breaks-restored.docx');
  const parts=unzipSync(readFileSync(path)),before=unzipSync(readFileSync(source));
  const counts=await page.evaluate(xml=>{
    const d=new DOMParser().parseFromString(xml,'application/xml'),w='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    return {paragraphs:d.getElementsByTagNameNS(w,'p').length,controls:d.getElementsByTagNameNS(w,'sdt').length,breaks:d.getElementsByTagNameNS(w,'br').length};
  },strFromU8(parts['word/document.xml']));
  expect(counts).toEqual({paragraphs:10,controls:10,breaks:2});
  for(const name of Object.keys(before))if(name!=='word/document.xml')expect(Buffer.from(parts[name]).equals(Buffer.from(before[name])),name).toBe(true);
  await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(input).toHaveValue(original.replace('Alpha beta',''));
  await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(input).toHaveValue(original);
  expect(unzipSync(readFileSync(await download('placeholder-breaks-undo.docx')))).toEqual(before);
  await reopenDocx(page,input,path,restored);
  await select('Second line');await page.keyboard.insertText('Replacement');
  await expect(input).toHaveValue(original.replace('Alpha beta','Replacement'));
});
