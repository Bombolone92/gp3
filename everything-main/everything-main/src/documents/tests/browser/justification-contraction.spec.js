import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
const folder='tests/fixtures/justification-contraction/';
const reference=JSON.parse(readFileSync(folder+'reference.json'));

for(const [name,ref] of Object.entries(reference.documents)) test(`matches independent native contraction controls: ${name}`,async({page})=>{
 await page.goto('/playground.html');
 const actual=await page.evaluate(async bytes=>{
  const {DocxPackage}=await import('/src/engine/docx.js');
  const {loadCanvasFonts,measureCanvasText}=await import('/src/engine/canvas-text.js');
  const {prepareCanvasFont,fontAvailable}=await import('/src/engine/font-availability.js');
  const {layoutDocument}=await import('/src/engine/layout.js');
  const {pageGeometry}=await import('/src/engine/page-settings.js');
  const {measureTextGeometry}=await import('/src/engine/text-geometry.js');
  const pkg=await DocxPackage.open(new Uint8Array(bytes));await loadCanvasFonts(pkg);
  for(const family of new Set(pkg.paragraphs.flatMap(p=>p.runs.map(r=>r.fontAscii))))if(family){await prepareCanvasFont(family);if(!fontAvailable(family))return {missing:family};}
  const ctx=document.createElement('canvas').getContext('2d'),measure=(t,s)=>measureCanvasText(ctx,t,s);
  const layout=layoutDocument(pkg.paragraphs,measure,pageGeometry(pkg.pageSettings));
  const widths=[];
  for(const line of layout.lines)for(const f of line.fragments)if(f.justificationSpacing<0){
   widths.push(Math.abs(f.width-measureTextGeometry(f.text,f,measure).width));
  }
  return {pages:layout.pages.map((_,i)=>layout.lines.filter(l=>l.page===i).map(l=>l.fragments.map(f=>f.text).join('').replace(/\s/gu,'')).filter(Boolean)),widths};
 },[...readFileSync(folder+name+'.docx')]);
 test.skip(!!actual.missing,`Requires installed reference font ${actual.missing}; fonts are not redistributed.`);
 expect(actual.pages).toEqual(ref.pages.map(p=>p.map(l=>l.text)));
 expect(actual.widths.every(w=>w<.001)).toBe(true);
 if(name!=='edges-mode14')expect(actual.widths.length).toBeGreaterThan(0);
});
