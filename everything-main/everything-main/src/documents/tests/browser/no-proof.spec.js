import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
import {downloadDocx} from './helpers/editor-tools.js';
import {reopenDocx} from './helpers/reopen-docx.js';
const source='tests/fixtures/no-proof/control.docx';
const original=unzipSync(readFileSync(source));
const proofing=page=>page.locator('.ed-proofing');
async function save(page,info,name) {
  const pending=page.waitForEvent('download');await downloadDocx(page);
  const path=info.outputPath(name);await (await pending).saveAs(path);return path;
}
const exact=path=>expect(unzipSync(readFileSync(path))).toEqual(original);
async function replace(page,input,start,end,text) {
  await input.focus();
  await input.evaluate((el,range)=>{el.setSelectionRange(...range);el.dispatchEvent(new Event('select',{bubbles:true}));},[start,end]);
  await page.keyboard.insertText(text);
}

test('proofing honors exemptions, corrections preserve them, and exports/undo retain source',async({page},info)=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/playground.html');
  await page.evaluate(()=>{localStorage.removeItem('documents:dictionary');localStorage.removeItem('documents:spellcheck');});
  await page.getByLabel('Open DOCX file').setInputFiles(source);
  const input=page.getByRole('textbox',{name:'Document text'});
  const text=Array(9).fill('Zzqxvble').join('\n');
  await expect(input).toHaveValue(text);
  await expect(proofing(page)).toHaveAttribute('aria-label',/5 errors found/);
  exact(await save(page,info,'no-proof-untouched.docx'));
  await replace(page,input,0,8,'Teh');
  await expect(input).toHaveValue('Teh'+text.slice(8));
  await input.press('ControlOrMeta+Home');await input.press('F7');
  const pane=page.getByRole('complementary',{name:'Spelling'});
  await expect(pane.locator('mark')).toHaveText('Teh');
  await pane.getByRole('option',{name:'The',exact:true}).click();
  await pane.getByRole('button',{name:'Change',exact:true}).click();
  await expect(proofing(page)).toHaveAttribute('aria-label',/4 errors found/);
  await page.getByRole('button',{name:'Close Spelling pane',exact:true}).click();
  await replace(page,input,4,12,'Teh');
  const edited='The\nTeh'+text.slice(17);
  await expect(input).toHaveValue(edited);
  await expect(proofing(page)).toHaveAttribute('aria-label',/4 errors found/);
  const exported=await save(page,info,'no-proof-edited.docx');
  for(const part of Object.keys(original).filter(p=>p!=='word/document.xml'))expect(unzipSync(readFileSync(exported))[part]).toEqual(original[part]);
  for(let i=0;i<3;i++)await page.getByRole('button',{name:'Undo',exact:true}).click();
  await expect(input).toHaveValue(text);
  await expect(proofing(page)).toHaveAttribute('aria-label',/5 errors found/);
  exact(await save(page,info,'no-proof-undo.docx'));
  await reopenDocx(page,input,exported,edited);
  await expect(proofing(page)).toHaveAttribute('aria-label',/4 errors found/);
  await input.press('ControlOrMeta+Home');await input.press('F7');
  await expect(pane.locator('mark')).toHaveText('Zzqxvble');
  expect(errors).toEqual([]);
});

test('correcting a mixed word changes only the ordinary fragment and retains the exempt prefix',async({page},info)=>{
  await page.goto('/playground.html');
  await page.getByLabel('Open DOCX file').setInputFiles(source);
  const input=page.getByRole('textbox',{name:'Document text'}),text=Array(9).fill('Zzqxvble').join('\n');
  await expect(input).toHaveValue(text);
  await expect(proofing(page)).toHaveAttribute('aria-label',/5 errors found/);
  await input.evaluate(el=>{el.setSelectionRange(49,49);el.dispatchEvent(new Event('select',{bubbles:true}));});
  await input.press('F7');
  const pane=page.getByRole('complementary',{name:'Spelling'});
  await expect(pane.locator('mark')).toHaveText('vble');
  const option=pane.getByRole('option').first();const replacement=await option.textContent();
  expect(replacement.length).toBeGreaterThan(0);await option.click();
  await pane.getByRole('button',{name:'Change',exact:true}).click();
  const edited=text.slice(0,49)+replacement+text.slice(53);
  await expect(input).toHaveValue(edited);
  await expect(proofing(page)).toHaveAttribute('aria-label',/4 errors found/);
  const exported=await save(page,info,'no-proof-mixed-edited.docx');
  for(const part of Object.keys(original).filter(p=>p!=='word/document.xml'))expect(unzipSync(readFileSync(exported))[part]).toEqual(original[part]);
  await page.getByRole('button',{name:'Undo',exact:true}).click();
  await expect(input).toHaveValue(text);exact(await save(page,info,'no-proof-mixed-undo.docx'));
  await reopenDocx(page,input,exported,edited);
  await expect(proofing(page)).toHaveAttribute('aria-label',/4 errors found/);
});
