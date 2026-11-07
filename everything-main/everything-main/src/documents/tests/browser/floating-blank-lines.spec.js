import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
const root='tests/fixtures/floating-blank-lines/';
test('floating drawings leave blank-line height controlled by the paragraph mark',async({page},info)=>{
 const ref=JSON.parse(readFileSync(root+'reference.json'));
 await page.goto('/playground.html');
 const actual=await page.evaluate(async bytes=>{
  const {DocxPackage}=await import('/src/engine/docx.js');
  const {loadCanvasFonts,measureCanvasText}=await import('/src/engine/canvas-text.js');
  const {layoutDocument}=await import('/src/engine/layout.js');
  const {pageGeometry}=await import('/src/engine/page-settings.js');
  const pkg=await DocxPackage.open(new Uint8Array(bytes));await loadCanvasFonts(pkg);
  const ctx=document.createElement('canvas').getContext('2d');
  const l=layoutDocument(pkg.paragraphs,(t,s)=>measureCanvasText(ctx,t,s),pageGeometry(pkg.pageSettings));
  return l.pages.map((_,i)=>Object.fromEntries(l.lines.filter(l=>l.page===i).map(l=>[l.fragments.filter(f=>!f.image).map(f=>f.text).join('').trim(),l.baseline*.75])));
 },[...readFileSync(root+'source.docx')]);
 writeFileSync(info.outputPath('baselines.json'),JSON.stringify(actual));
 expect(actual).toHaveLength(ref.pages.length);
 for(const [i,r] of ref.pages.entries())for(const text of ['Before','After'])expect(Math.abs(actual[i][text]-r[text]),`page ${i+1} ${text}`).toBeLessThan(.15);
});
