import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root='tests/fixtures/auto-line-spacing-rounding/';

test('long automatic line intervals match native pages across manual and paragraph breaks',async({page},info)=>{
 test.setTimeout(120000);
 const reference=JSON.parse(readFileSync(root+'reference.json'));
 const source=readFileSync(root+'control.docx');
 expect(createHash('sha256').update(source).digest('hex')).toBe(reference.sourceSha256);
 expect(createHash('sha256').update(readFileSync(root+'cases.json')).digest('hex')).toBe(reference.casesSha256);
 await page.goto('/playground.html');
 const layout=await page.evaluate(async bytes=>{
  const {DocxPackage}=await import('/src/engine/docx.js');
  const {loadCanvasFonts,measureCanvasText,setCanvasFontAlternatives}=await import('/src/engine/canvas-text.js');
  const {layoutDocument}=await import('/src/engine/layout.js');
  const {pageGeometry}=await import('/src/engine/page-settings.js');
  const pkg=await DocxPackage.open(Uint8Array.from(atob(bytes),c=>c.charCodeAt(0)));
  const ctx=document.createElement('canvas').getContext('2d');
  setCanvasFontAlternatives(ctx,pkg.styles.fontAlternatives);await loadCanvasFonts(pkg);
  const result=layoutDocument(pkg.paragraphs,(t,s)=>measureCanvasText(ctx,t,s),pageGeometry(pkg.pageSettings),pkg.numbering,pkg.tables,pkg.pageStories,{styles:pkg.styles});
  return {pages:result.pages.length,lines:result.lines.map(l=>({page:l.page,text:l.fragments.map(f=>f.text||'').join('').trim(),baseline:l.baseline*.75}))};
 },source.toString('base64'));
 writeFileSync(info.outputPath('layout.json'),JSON.stringify(layout,null,2)+'\n');
 expect(layout.pages).toBe(reference.pages);expect(layout.lines).toHaveLength(reference.lines);
 for(const c of reference.cases){
  const rows=layout.lines.filter(l=>l.page===c.page);
  expect(rows.map(r=>r.text)).toEqual(c.labels);
  // Compare every relative baseline, retaining the 600-unit native rounding
  // envelope. Absolute first-baseline placement is a separate open question.
  rows.forEach((r,i)=>expect(Math.abs((r.baseline-rows[0].baseline)-(c.baselinesPt[i]-c.baselinesPt[0]))).toBeLessThan(.12));
 }
});
