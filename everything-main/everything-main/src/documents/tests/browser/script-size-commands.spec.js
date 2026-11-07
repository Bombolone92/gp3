import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';
import { showAllTools } from './helpers/editor-tools.js';

test('size input applies both sizes, including unchanged Enter, pending typing, export and exact undo', async ({page}, info) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/playground.html'); await showAllTools(page);
  const source = 'tests/fixtures/complex-script-properties/control.docx';
  await page.getByLabel('Open DOCX file').setInputFiles(source);
  const input = page.getByRole('textbox', {name:'Document text'}), size = page.getByRole('spinbutton', {name:'Font size (pt)',exact:true});
  await expect(input).toHaveValue(/Default Latin text/);
  const original = await input.inputValue();
  const select = async (start,end=start) => input.evaluate((el,[a,b]) => { el.setSelectionRange(a,b); el.dispatchEvent(new Event('select',{bubbles:true})); },[start,end]);
  const download = async name => {
    const pending = page.waitForEvent('download'); await page.getByRole('button',{name:'Download .docx',exact:true}).click();
    const path = info.outputPath(name); await (await pending).saveAs(path); return path;
  };
  const formats = async path => page.evaluate(async bytes => {
    const {DocxPackage} = await import('/src/engine/docx.js'); const pkg = await DocxPackage.open(new Uint8Array(bytes));
    return pkg.paragraphs[0].runs.map(r => [r.text,r.fontSize,r.fontSizeCs]);
  }, [...readFileSync(path)]);
  await select(0,7); await expect(size).toHaveValue('10');
  await size.press('Enter'); await expect(input).toBeFocused();
  const same = await download('same-size.docx');
  expect((await formats(same))[0]).toEqual(['Default',10,10]);
  await size.fill('18.5'); await size.press('Tab');
  const changed = await download('changed-size.docx');
  expect(await formats(changed)).toEqual([['Default',18.5,18.5],[' Latin text',10,14]]);
  await select(2); await size.fill('12.5'); await size.press('Enter'); await input.pressSequentially('X');
  const typed = await download('typed-size.docx');
  expect((await formats(typed)).slice(0,3)).toEqual([['De',18.5,18.5],['X',12.5,12.5],['fault',18.5,18.5]]);
  for (let i=0;i<3;i++) await page.getByRole('button',{name:'Undo',exact:true}).click();
  const restored = await download('undo.docx'); expect(unzipSync(readFileSync(restored))).toEqual(unzipSync(readFileSync(source)));
  await reopenDocx(page,input,typed,original.slice(0,2)+'X'+original.slice(2));
  await select(2,3); await expect(size).toHaveValue('12.5'); expect(errors).toEqual([]);
});
