import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
import {expectBodyEditParts} from './helpers/expect-body-edit-parts.js';
const root='tests/fixtures/manual-break-metrics/';
for(const mode of [14,15])test(`native manual-break metrics and editing, compatibility ${mode}`,async({page},info)=>{
 test.setTimeout(120000);
 const source=root+`mode${mode}.docx`,ref=JSON.parse(readFileSync(root+`mode${mode}-reference.json`));
 for(const [file,hash]of [[source,ref.sourceSha256],[root+`mode${mode}-native.pdf`,ref.pdfSha256]])expect(createHash('sha256').update(readFileSync(file)).digest('hex')).toBe(hash);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^Case 1/);await expect(input).toHaveJSProperty('readOnly',false);
 await expect(page.locator('canvas.canvas-page')).toHaveCount(ref.pages.length);
 const actual=await page.evaluate(async bytes=>{
  const {DocxPackage}=await import('/src/engine/docx.js');const {loadCanvasFonts,measureCanvasText}=await import('/src/engine/canvas-text.js');
  const {layoutDocument}=await import('/src/engine/layout.js');const {pageGeometry}=await import('/src/engine/page-settings.js');
  const pkg=await DocxPackage.open(new Uint8Array(bytes));await loadCanvasFonts(pkg);const ctx=document.createElement('canvas').getContext('2d');
  const l=layoutDocument(pkg.paragraphs,(t,s)=>measureCanvasText(ctx,t,s),pageGeometry(pkg.pageSettings),pkg.numbering,pkg.tables);
  return l.pages.map((_,i)=>Object.fromEntries(l.lines.filter(l=>l.page===i).map(l=>[l.fragments.map(f=>f.text).join('').trim(),l.baseline*.75])));
 },[...readFileSync(source)]);
 writeFileSync(info.outputPath('baselines.json'),JSON.stringify(actual));
 expect(actual).toHaveLength(ref.pages.length);
 for(const [i,r]of ref.pages.entries())for(const [text,baseline]of Object.entries(r))expect(Math.abs(actual[i][text]-baseline),`page ${i+1} ${text}`).toBeLessThan(.15);
 writeFileSync(info.outputPath('rendered.png'),Buffer.from(await page.locator('canvas.canvas-page').nth(1).evaluate(c=>c.toDataURL().split(',')[1]),'base64'));
 const original=await input.inputValue(),parts=unzipSync(readFileSync(source));
 const save=async name=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await pending).saveAs(path);return path;};
 expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
 // Remove the first text before a large-font break. The break must now supply
 // the blank line's metrics while keeping its stored formatting through save.
 const at=original.indexOf('First',original.indexOf('Case 2'));
 await input.evaluate((el,{at})=>{el.focus();el.setSelectionRange(at,at+5);el.dispatchEvent(new Event('select',{bubbles:true}));},{at});
 await input.press('Backspace');
 const editedText=original.slice(0,at)+original.slice(at+5);await expect(input).toHaveValue(editedText);
 const edited=await save('edited'),changed=unzipSync(readFileSync(edited));
 expectBodyEditParts(changed,parts);
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);
 await reopenDocx(page,input,edited,editedText);await expect(page.locator('#playground-error')).toBeEmpty();expect(errors).toEqual([]);
});

test('large spaces before a terminal page break use its small paragraph mark',async({page})=>{
 const name='page-break-large-space',ref=JSON.parse(readFileSync(root+name+'-reference.json'));
 for(const [suffix,hash]of [['.docx',ref.sourceSha256],['-native.pdf',ref.pdfSha256]])expect(createHash('sha256').update(readFileSync(root+name+suffix)).digest('hex')).toBe(hash);
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(root+name+'.docx');
 await expect(page.getByRole('textbox',{name:'Document text'})).toHaveJSProperty('readOnly',false);
 await expect(page.locator('canvas.canvas-page')).toHaveCount(ref.pages.length);
 expect(ref.pages).toEqual(['Before','After']);
});
