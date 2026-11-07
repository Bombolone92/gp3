// Native reference line-break diagnostic: exits nonzero on any mismatch.
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const folder='tests/fixtures/justification-contraction/';
const refs=JSON.parse(readFileSync(folder+'reference.json'));
const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||'msedge',headless:true});
const result={documents:{},mismatches:[]};
try {
 const page=await browser.newPage();await page.goto(process.env.DOCX_TEST_URL||'http://127.0.0.1:5173/playground.html');
 for(const [name,ref] of Object.entries(refs.documents)){
  const actual=await page.evaluate(async bytes=>{
   const {DocxPackage}=await import('/src/engine/docx.js');
   const {loadCanvasFonts,measureCanvasText}=await import('/src/engine/canvas-text.js');
   const {fontAvailable,prepareCanvasFont}=await import('/src/engine/font-availability.js');
   const {layoutDocument}=await import('/src/engine/layout.js');
   const {pageGeometry}=await import('/src/engine/page-settings.js');
   const pkg=await DocxPackage.open(new Uint8Array(bytes));await loadCanvasFonts(pkg);
   for(const family of new Set(pkg.paragraphs.flatMap(p=>p.runs.map(r=>r.fontAscii))))if(family){await prepareCanvasFont(family);if(!fontAvailable(family))throw new Error(`Missing reference font: ${family}`);}
   const ctx=document.createElement('canvas').getContext('2d');
   const l=layoutDocument(pkg.paragraphs,(t,s)=>measureCanvasText(ctx,t,s),pageGeometry(pkg.pageSettings));
   return l.pages.map((_,i)=>l.lines.filter(line=>line.page===i).map(line=>({text:line.fragments.map(f=>f.text).join('').replace(/\s/gu,''),x:line.stops[0].x*.75,y:line.baseline*.75})).filter(line=>line.text));
  },[...readFileSync(folder+name+'.docx')]);
  const failures=[];
  for(let i=0;i<Math.max(actual.length,ref.pages.length);i++){
   const a=(actual[i]||[]).map(l=>l.text),expected=(ref.pages[i]||[]).map(l=>l.text);
   if(JSON.stringify(a)!==JSON.stringify(expected))failures.push({page:i+1,expected,actual:a});
  }
  result.documents[name]={pages:actual.length,mismatches:failures.length,actual};
  result.mismatches.push(...failures.map(f=>({document:name,...f})));
 }
} finally {await browser.close();}
if(process.argv[2])writeFileSync(resolve(process.argv[2]),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({documents:Object.fromEntries(Object.entries(result.documents).map(([name,d])=>[name,{pages:d.pages,mismatches:d.mismatches}])),mismatches:result.mismatches.length},null,2));
process.exitCode=result.mismatches.length?1:0;
