import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
const folder='tests/fixtures/script-metric-notice/',source=folder+'control.docx';
test.setTimeout(120000);

const load=async(page,file=source)=>{
 await page.goto('/playground.html');await page.getByRole('textbox',{name:'Document text'}).waitFor();
 // A CSS-available original face with no application font-program metadata
 // reproduces the installed-face/no-access state without reading system fonts.
 await page.evaluate(async encoded=>{
  const bytes=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));
  document.fonts.add(await new FontFace('Original Script Notice',bytes).load());
 },readFileSync(folder+'control.ttf').toString('base64'));
 await page.getByLabel('Open DOCX file').setInputFiles(file);
 await expect(page.getByRole('textbox',{name:'Document text'})).toHaveValue(/^NORMAL/);
};
const save=async(page,info,name)=>{
 const event=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();
 const path=info.outputPath(name+'.docx');await(await event).saveAs(path);return path;
};

test('CSS-only script metrics are disclosed, and file-font refresh clears the notice without an edit',async({page},info)=>{
 await load(page);const input=page.getByRole('textbox',{name:'Document text'}),warning=page.locator('[data-script-font-warning]');
 await expect(input).toHaveJSProperty('readOnly',false);await expect(warning).toContainText('Original Script Notice');
 await expect(warning).not.toContainText('Noto Sans');await expect(warning).not.toContainText('read-only');
 const before=await input.inputValue();
 expect(unzipSync(readFileSync(await save(page,info,'before')))).toEqual(unzipSync(readFileSync(source)));
 await page.getByRole('button',{name:'Latin font family',exact:true}).click();
 await page.getByLabel('Font files',{exact:true}).setInputFiles(folder+'control.ttf');
 await expect(page.getByRole('status').filter({hasText:'Available in this session: Original Script Notice'})).toBeVisible();
 await expect(warning).toHaveCount(0);await page.keyboard.press('Escape');
 await expect(input).toHaveValue(before);await expect(input).toHaveJSProperty('readOnly',false);
 expect(unzipSync(readFileSync(await save(page,info,'after')))).toEqual(unzipSync(readFileSync(source)));
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(before);await expect(warning).toHaveCount(0);
 await expect(page.locator('.canvas-message-error')).toHaveCount(0);
});

test('a header-only script produces the font notice while normal body text and picture formatting do not',async({page})=>{
 await load(page,folder+'header-only.docx');
 await expect(page.locator('[data-script-font-warning]')).toContainText('Original Script Notice');
 await expect(page.getByRole('textbox',{name:'Document text'})).toHaveJSProperty('readOnly',false);
 await expect(page.locator('canvas.canvas-page')).toHaveCount(1);
});

test('removing script formatting clears the notice and undo restores it',async({page},info)=>{
 await load(page);const input=page.getByRole('textbox',{name:'Document text'}),warning=page.locator('[data-script-font-warning]'),original=await input.inputValue();
 for(const [text,tool]of [['RAISED','Superscript'],['LOWERED','Subscript']]){
  const start=original.indexOf(text);await input.focus();await input.evaluate((e,{start,length})=>e.setSelectionRange(start,start+length),{start,length:text.length});
  await page.getByRole('button',{name:tool,exact:true}).click();
 }
 await expect(warning).toHaveCount(0);await input.press('ControlOrMeta+z');await expect(warning).toContainText('Original Script Notice');
 await input.press('ControlOrMeta+z');expect(unzipSync(readFileSync(await save(page,info,'undo')))).toEqual(unzipSync(readFileSync(source)));
});
