import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root='tests/fixtures/note-mark-metrics/',ref=JSON.parse(readFileSync(root+'reference.json'));
test('native note-mark allocation and automatic line-spacing matrix',async({page},info)=>{
 const bytes=readFileSync(root+'control.docx');
 expect(createHash('sha256').update(bytes).digest('hex')).toBe(ref.sourceSha256);
 expect(createHash('sha256').update(readFileSync(root+'native.pdf')).digest('hex')).toBe(ref.pdfSha256);
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(root+'control.docx');
 await expect(page.getByRole('textbox',{name:'Document text'})).toHaveValue(/Following line$/);
 await expect(page.getByRole('textbox',{name:'Document text'})).toHaveJSProperty('readOnly',false);
 await expect(page.locator('canvas.canvas-page')).toHaveCount(ref.cases.length);
 const actual=await page.evaluate(async bytes=>{
  const {DocxPackage}=await import('/src/engine/docx.js'),{validateCanvasLayout,measureCanvasText}=await import('/src/engine/canvas-text.js');
  const {layoutDocument}=await import('/src/engine/layout.js'),{pageGeometry}=await import('/src/engine/page-settings.js');
  const p=await DocxPackage.open(Uint8Array.from(atob(bytes),c=>c.charCodeAt(0)));await validateCanvasLayout(p);
  const ctx=document.createElement('canvas').getContext('2d');
  return layoutDocument(p.paragraphs,(t,s)=>measureCanvasText(ctx,t,s),pageGeometry(p.pageSettings),p.numbering,p.tables).lines.map(l=>({page:l.page,baseline:l.baseline*.75,text:l.fragments.map(f=>f.text).join('')}));
 },bytes.toString('base64'));
 writeFileSync(info.outputPath('actual.json'),JSON.stringify(actual,null,2));
 for(const [index,c]of ref.cases.entries())for(const text of [c.alone?'1':'Before','Following line']){
  const native=c.spans.find(s=>s.text===text),line=actual.find(l=>l.page===index&&l.text.startsWith(text));
  expect(line,c.name).toBeTruthy();
  // Existing explicit-position rounding differs by up to half a point.
  expect(Math.abs(line.baseline-native.baseline),c.name+' '+text).toBeLessThan(c.shift ? .6 : .25);
 }
 for(const index of [0,1,3,4,6,7,27,28,30,31])writeFileSync(info.outputPath('page-'+(index+1)+'.png'),Buffer.from(await page.locator('canvas.canvas-page').nth(index).evaluate(c=>c.toDataURL().split(',')[1]),'base64'));
});
