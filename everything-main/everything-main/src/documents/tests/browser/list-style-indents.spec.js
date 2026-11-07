import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { showAllTools } from './helpers/editor-tools.js';
import { reopenDocx } from './helpers/reopen-docx.js';

test('renders inherited list geometry against the native reference and preserves it through editing and reopening', async ({page},info) => {
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/playground.html'); await showAllTools(page);
  await page.getByLabel('Open DOCX file').setInputFiles('public/fixtures/list-style-indents.docx');
  const input=page.getByRole('textbox',{name:'Document text'});
  await expect(input).toHaveValue(/^A01: No indent declarations/);
  await expect(page.locator('canvas.canvas-page')).toHaveCount(3);
  const positions=await page.evaluate(async()=>{
    const {DocxPackage}=await import('/src/engine/docx.js');
    const {layoutDocument}=await import('/src/engine/layout.js');
    const {pageGeometry}=await import('/src/engine/page-settings.js');
    const {measureCanvasText,loadCanvasFonts}=await import('/src/engine/canvas-text.js');
    const pkg=await DocxPackage.open(new Uint8Array(await(await fetch('/fixtures/list-style-indents.docx')).arrayBuffer()));
    await loadCanvasFonts(pkg);
    const ctx=document.createElement('canvas').getContext('2d');
    const result=layoutDocument(pkg.paragraphs,(text,style)=>measureCanvasText(ctx,text,style),pageGeometry(pkg.pageSettings),pkg.numbering);
    return pkg.paragraphs.filter(p=>p.list).map(p=>{
      const lines=result.lines.filter(l=>l.paragraphId===p.id);
      return {id:p.runs.map(r=>r.text).join('').match(/First(A\d+)/)[1],page:lines[0].page+1,markerX:lines[0].marker.x*.75,firstX:lines[0].stops[0].x*.75,secondX:lines[1].stops[0].x*.75};
    });
  });
  const reference=JSON.parse(readFileSync('tests/fixtures/list-style-indents/reference.json'));
  expect(positions.length).toBe(24);
  for(const row of reference.cases){
    const actual=positions.find(p=>p.id===row.id); expect(actual.page).toBe(row.page);
    for(const key of ['markerX','firstX','secondX'])expect(Math.abs(actual[key]-row[key]),row.id+' '+key).toBeLessThan(.1);
  }
  const images=await page.locator('canvas.canvas-page').evaluateAll(cs=>cs.map(c=>c.toDataURL().split(',')[1]));
  images.forEach((png,i)=>writeFileSync(info.outputPath(`page-${i+1}.png`),Buffer.from(png,'base64')));
  await input.evaluate(el=>{const n=el.value.indexOf('FirstA02');el.setSelectionRange(n,n);el.dispatchEvent(new Event('select',{bubbles:true}));});
  await page.keyboard.insertText('Edited ');
  const text=await input.inputValue();
  const download=page.waitForEvent('download'); await page.getByRole('button',{name:'Download .docx',exact:true}).click();
  const saved=info.outputPath('list-style-indents.docx');await(await download).saveAs(saved);
  const before=unzipSync(readFileSync('public/fixtures/list-style-indents.docx')),after=unzipSync(readFileSync(saved));
  for(const name of Object.keys(before))if(name!=='word/document.xml')expect(Buffer.from(after[name]).equals(Buffer.from(before[name])),name).toBe(true);
  await page.getByRole('button',{name:'Undo',exact:true}).click();
  const original=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();
  const undo=info.outputPath('list-style-indents-undo.docx');await(await original).saveAs(undo);
  const restored=unzipSync(readFileSync(undo));for(const name of Object.keys(before))expect(Buffer.from(restored[name]).equals(Buffer.from(before[name])),name).toBe(true);
  await reopenDocx(page,input,saved,text);await expect(page.locator('canvas.canvas-page')).toHaveCount(3);
  expect(errors).toEqual([]);
});
