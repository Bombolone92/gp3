import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';
const source = 'public/fixtures/exact-font-baseline.docx';
const reference = JSON.parse(readFileSync('tests/fixtures/exact-font-baseline/positions.json','utf8'));

test('matches native exact baselines across fonts, sizes and line heights through editing', async ({page}, info) => {
  expect(createHash('sha256').update(readFileSync(source)).digest('hex')).toBe(reference.sourceSha256);
  await page.goto('/playground.html');
  await page.getByLabel('Open DOCX file').setInputFiles(source);
  const input=page.getByRole('textbox',{name:'Document text'});
  await expect(input).toHaveValue(/^Arial SIZE 12 EXACT 12/); await expect(input).toHaveJSProperty('readOnly',false);
  await expect(page.locator('canvas.canvas-page')).toHaveCount(4);
  const actual=await page.evaluate(async()=>{
    const {DocxPackage}=await import('/src/engine/docx.js');
    const {loadCanvasFonts,measureCanvasText}=await import('/src/engine/canvas-text.js');
    const {layoutDocument}=await import('/src/engine/layout.js');
    const {pageGeometry}=await import('/src/engine/page-settings.js');
    const pkg=await DocxPackage.open(new Uint8Array(await(await fetch('/fixtures/exact-font-baseline.docx')).arrayBuffer()));
    await loadCanvasFonts(pkg); const ctx=document.createElement('canvas').getContext('2d');
    return layoutDocument(pkg.paragraphs,(t,s)=>measureCanvasText(ctx,t,s),pageGeometry(pkg.pageSettings)).lines.map(l=>({page:l.page,text:l.fragments.map(f=>f.text).join(''),baseline:l.baseline*.75}));
  });
  expect(actual).toHaveLength(reference.lines.length);
  for(const [i,line] of actual.entries()) {
    expect(line.text).toBe(reference.lines[i].text); expect(line.page).toBe(reference.lines[i].page);
    expect(Math.abs(line.baseline-reference.lines[i].baseline),line.text).toBeLessThan(.06);
  }
  const images=await page.locator('canvas.canvas-page').evaluateAll(canvases=>canvases.map(canvas=>canvas.toDataURL()));
  for(const [i,data] of images.entries()) writeFileSync(info.outputPath(`page-${i+1}.png`),Buffer.from(data.split(',')[1],'base64'));
  const original=await input.inputValue(), parts=unzipSync(readFileSync(source));
  const save=async name=>{const event=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await event).saveAs(path);return path;};
  expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
  await input.press('ControlOrMeta+Home');await page.keyboard.insertText('EDIT ');const edited=await save('edited');
  const changed=unzipSync(readFileSync(edited));for(const name of Object.keys(parts))if(name!=='word/document.xml')expect(changed[name],name).toEqual(parts[name]);
  await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);
  await reopenDocx(page,input,edited,'EDIT '+original);await expect(page.locator('#playground-error')).toBeEmpty();
});
