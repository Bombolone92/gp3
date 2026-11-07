import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root='tests/fixtures/first-baseline-rounding/';

test('ordinary baselines retain native accuracy across font sizes and faces',async({page},info)=>{
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
  // Preserve the production 200-page guard. Independent page-break controls
  // can be measured as two groups without changing any paragraph formatting.
  const batches=[pkg.paragraphs.slice(0,144),pkg.paragraphs.slice(144)].map(paragraphs=>
   layoutDocument(paragraphs,(t,s)=>measureCanvasText(ctx,t,s),pageGeometry(pkg.pageSettings),pkg.numbering,pkg.tables,pkg.pageStories,{styles:pkg.styles}));
  return {pages:batches.reduce((n,b)=>n+b.pages.length,0),lines:batches.flatMap((b,i)=>b.lines.map(l=>
   ({page:l.page+i*144,text:l.fragments.map(f=>f.text||'').join('').trim(),baseline:l.baseline*.75,height:l.height*.75,ascent:l.ascent*.75,descent:l.descent*.75})))};
 },source.toString('base64'));
 writeFileSync(info.outputPath('layout.json'),JSON.stringify(layout,null,2)+'\n');
 expect(layout.pages).toBe(reference.pages);expect(layout.lines).toHaveLength(reference.lines);
 for(const c of reference.cases){
  const rows=layout.lines.filter(l=>l.page===c.page);
  expect(rows.map(r=>r.text)).toEqual(c.labels);
  rows.forEach((r,i)=>{
   expect(Math.abs(r.baseline-c.baselinesPt[i])).toBeLessThan(.2);
   expect(Math.abs((r.baseline-rows[0].baseline)-(c.baselinesPt[i]-c.baselinesPt[0]))).toBeLessThan(.12);
  });
  // Native controls reject independently rounding allocation, descent and
  // extra leading: that proposal worsens these already accurate first lines.
  if(c.size===60&&c.multiple===259&&c.family!=='Trebuchet MS')
   expect(Math.abs(rows[0].baseline-c.baselinesPt[0])).toBeLessThan(.03);
 }
});
