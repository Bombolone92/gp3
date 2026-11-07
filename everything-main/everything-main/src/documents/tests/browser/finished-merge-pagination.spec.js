import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';
const folder='tests/fixtures/finished-merge-pagination',refs=JSON.parse(readFileSync(`${folder}/reference.json`));
for(const [name,ref] of Object.entries(refs))test(`${name}: native page cuts, continued merge text, edit/export/reopen`,async({page},info)=>{
  const source=`${folder}/${name}.docx`,bytes=readFileSync(source),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/playground.html');
  const installed=await page.evaluate(async()=>{try{await new FontFace('Reference check','local("Arial")').load();return true;}catch{return false;}});
  test.skip(!installed,'Native reference requires Arial.');
  await page.getByLabel('Open DOCX file').setInputFiles(source);
  const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^Before table/);await expect(input).toHaveJSProperty('readOnly',false);
  await expect(page.locator('canvas.canvas-page')).toHaveCount(ref.pages);
  const lines=await page.evaluate(async bytes=>{
    const {DocxPackage}=await import('/src/engine/docx.js'),{layoutDocument}=await import('/src/engine/layout.js'),{pageGeometry}=await import('/src/engine/page-settings.js'),{loadCanvasFonts,measureCanvasText}=await import('/src/engine/canvas-text.js');
    const p=await DocxPackage.open(Uint8Array.from(atob(bytes),c=>c.charCodeAt(0)));await loadCanvasFonts(p);const ctx=document.createElement('canvas').getContext('2d');
    return layoutDocument(p.paragraphs,(t,s)=>measureCanvasText(ctx,t,s),pageGeometry(p.pageSettings),p.numbering,p.tables,p.pageStories).lines.map(l=>({page:l.page,text:l.fragments.map(f=>f.text||'').join('').trim(),x:l.fragments[0]?.x*.75,y:l.baseline*.75}));
  },bytes.toString('base64'));
  for(const expected of ref.lines){const actual=lines.find(l=>l.text===expected.text);expect(actual?.page,expected.text).toBe(expected.page);expect(Math.abs(actual.x-expected.x),`${expected.text} x`).toBeLessThan(.3);expect(Math.abs(actual.y-expected.y),`${expected.text} y`).toBeLessThan(.3);}
  for(let i=0;i<ref.pages;i++)writeFileSync(info.outputPath(`page${i+1}.png`),Buffer.from(await page.locator('canvas.canvas-page').nth(i).evaluate(c=>c.toDataURL().split(',')[1]),'base64'));
  const original=await input.inputValue();await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');
  const save=async suffix=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(`${name}-${suffix}.docx`);await(await pending).saveAs(path);return path;};
  const edited=await save('edited'),parts=unzipSync(bytes),out=unzipSync(readFileSync(edited));
  for(const file of Object.keys(parts))if(file!=='word/document.xml')expect(Buffer.from(out[file]).equals(Buffer.from(parts[file])),file).toBe(true);
  await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);await expect(page.locator('canvas.canvas-page')).toHaveCount(ref.pages);
  const undone=unzipSync(readFileSync(await save('undo')));for(const file of Object.keys(parts))expect(Buffer.from(undone[file]).equals(Buffer.from(parts[file])),file).toBe(true);
  await reopenDocx(page,input,edited,'Edited '+original);await expect(page.locator('canvas.canvas-page')).toHaveCount(ref.pages);await expect(page.locator('#playground-error')).toBeEmpty();expect(errors).toEqual([]);
});
