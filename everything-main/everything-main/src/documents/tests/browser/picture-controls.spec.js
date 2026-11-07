import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import { showAllTools } from './helpers/editor-tools.js';
import { reopenDocx } from './helpers/reopen-docx.js';
const source = 'tests/fixtures/picture-controls/control.docx';
for (const placeholder of [false,true]) for (const kind of ['persistent','temporary']) test(`edits ${kind} picture ${placeholder ? 'placeholders' : 'controls'} and retains native wrapper behavior`, async ({page},info) => {
  test.setTimeout(90000);
  const source = `tests/fixtures/picture-controls/${placeholder ? 'placeholders/' : ''}control.docx`;
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/playground.html'); await showAllTools(page);
  await page.getByLabel('Open DOCX file').setInputFiles(source);
  const input=page.getByRole('textbox',{name:'Document text'});
  await expect(input).toHaveValue(/temporary-replace/);await expect(input).toHaveJSProperty('readOnly',false);
  const original=await input.inputValue(),parts=unzipSync(readFileSync(source));
  const select=async suffix=>{
    const name=kind+'-'+suffix,at=(await input.inputValue()).indexOf(name+': ')+name.length+2;
    await input.evaluate((el,at)=>{el.focus();el.setSelectionRange(at,at+1);el.dispatchEvent(new Event('select',{bubbles:true}));},at);
  };
  const save=async name=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await pending).saveAs(path);return path;};
  const check=async(path,suffix)=>{
    const xml=strFromU8(unzipSync(readFileSync(path))['word/document.xml']);
    return page.evaluate(({xml,name})=>{
      const w='http://schemas.openxmlformats.org/wordprocessingml/2006/main',doc=new DOMParser().parseFromString(xml,'application/xml');
      const controls=[...doc.getElementsByTagNameNS(w,'sdt')],c=controls.find(c=>c.getElementsByTagNameNS(w,'alias')[0]?.getAttributeNS(w,'val')===name);
      return {controls:controls.length,pictures:doc.getElementsByTagNameNS(w,'drawing').length,inside:c?c.getElementsByTagNameNS(w,'drawing').length:0};
    },{xml,name:kind+'-'+suffix});
  };
  await select('resize');await page.getByRole('button',{name:'Image properties',exact:true}).click();
  await page.getByLabel('Image width (in)',{exact:true}).fill('1.25');await page.getByRole('button',{name:'Apply',exact:true}).click();
  const resized=await save('resized');expect(await check(resized,'resize')).toEqual({controls:8,pictures:8,inside:1});
  const resizedParts=unzipSync(readFileSync(resized));for(const name of Object.keys(parts))if(name!=='word/document.xml')expect(resizedParts[name],name).toEqual(parts[name]);
  await input.press('ControlOrMeta+z');expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);
  await select('replace');await page.getByLabel('Insert image file').setInputFiles('tests/fixtures/picture-controls/replacement.png');
  await expect(page.getByRole('button',{name:'Undo',exact:true})).toBeEnabled();
  await expect(input).toHaveValue(placeholder ? original : original.replace(kind+'-replace: \ufffc',kind+'-replace: \ufffc\ufffc'));
  const inserted=await save('inserted');expect(await check(inserted,'replace')).toEqual({controls:kind==='persistent'?8:7,pictures:placeholder?8:9,inside:kind==='persistent'?(placeholder?1:2):0});
  const insertedText=await input.inputValue();await input.press('ControlOrMeta+z');expect(unzipSync(readFileSync(await save('insert-undo')))).toEqual(parts);
  await reopenDocx(page,input,inserted,insertedText);await expect(input).toHaveJSProperty('readOnly',false);
  writeFileSync(info.outputPath('page.png'),Buffer.from(await page.locator('canvas.canvas-page').first().evaluate(c=>c.toDataURL().split(',')[1]),'base64'));
  expect(errors).toEqual([]);await expect(page.locator('#playground-error')).toBeEmpty();
});

test('rejects typing and deletion of picture-only contents without changing the package', async ({page},info) => {
  await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
  const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/temporary-replace/);
  const original=await input.inputValue();
  for(const kind of ['persistent','temporary']) for(const action of ['type','delete']) {
    const label=kind+'-'+action+': ',at=original.indexOf(label)+label.length;
    await input.evaluate((el,at)=>{el.focus();el.setSelectionRange(at,at+1);el.dispatchEvent(new Event('select',{bubbles:true}));},at);
    if(action==='type')await page.keyboard.insertText('Typed');else await input.press('Delete');
    await expect(input).toHaveValue(original);await expect(page.getByRole('status')).toContainText('picture content control');
  }
  const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();
  const path=info.outputPath('unchanged.docx');await(await pending).saveAs(path);
  expect(unzipSync(readFileSync(path))).toEqual(unzipSync(readFileSync(source)));
});
