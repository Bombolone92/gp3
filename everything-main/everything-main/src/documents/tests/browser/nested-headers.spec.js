import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
const reference=JSON.parse(readFileSync('tests/fixtures/nested-tables/nested-header-reference.json','utf8'));
const ink=JSON.parse(readFileSync('tests/fixtures/nested-tables/nested-header-native-ink.json','utf8'));
// Match the precision of the border tests: a subpixel terminal band must have
// full-color samples, rather than disappear from the exact-color classifier.
test.use({ deviceScaleFactor: 3 });
for(const [mode,expected] of Object.entries(reference))test(`preserves native nested header behavior in the browser: ${mode}`,async({page},info)=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/playground.html');
 await page.getByLabel('Open DOCX file').setInputFiles(`public/fixtures/nested-${mode}.docx`);
 await expect(page.getByRole('textbox',{name:'Document text'})).toHaveValue(/After outer table/);
 await expect(page.locator('canvas.canvas-page')).toHaveCount(expected.pageCount);
 const actual=await page.evaluate(async mode=>{
  await document.fonts.ready;
  const {DocxPackage}=await import('/src/engine/docx.js'),{layoutDocument}=await import('/src/engine/layout.js'),{paragraphText}=await import('/src/engine/model.js'),{pageGeometry}=await import('/src/engine/page-settings.js'),{fontMetrics}=await import('/src/engine/font-metrics.js'),{setCanvasTextStyle}=await import('/src/engine/canvas-text.js');
  const pkg=await DocxPackage.open(new Uint8Array(await(await fetch(`/fixtures/nested-${mode}.docx`)).arrayBuffer())),ctx=document.createElement('canvas').getContext('2d');
  const layout=layoutDocument(pkg.paragraphs,(text,style)=>{setCanvasTextStyle(ctx,style);return {...fontMetrics(style),width:ctx.measureText(text).width};},pageGeometry(pkg.pageSettings),pkg.numbering,pkg.tables);
  const labels=new Map(pkg.paragraphs.map(p=>[p.id,paragraphText(p)]));
  return {pageCount:layout.pageCount,lines:[...layout.lines,...layout.repeatedLines].map(l=>({text:labels.get(l.paragraphId),page:l.page}))};
 },mode);
 expect(actual.pageCount).toBe(expected.pageCount);
 for(const [label,pages] of Object.entries(expected.labels))expect(actual.lines.filter(l=>l.text===label).map(l=>l.page).sort(),label).toEqual(pages);
 if(mode==='header-container')for(let index=0;index<expected.pageCount;index++) {
  const canvas=page.locator('canvas.canvas-page').nth(index);
  await canvas.screenshot({path:info.outputPath(`nested-header-page-${index+1}.png`)});
  const bounds=await canvas.evaluate(c=>{
   const data=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let top=Infinity,bottom=-Infinity;
   for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++){const at=4*(y*c.width+x);if([201,231,181].every((v,i)=>Math.abs(data[at+i]-v)<=1)){top=Math.min(top,y);bottom=Math.max(bottom,y+1);}}
   return {top:top*612/c.width,bottom:bottom*612/c.width};
  });
  expect(Math.abs(bounds.top-ink[index].top)).toBeLessThan(1);expect(Math.abs(bounds.bottom-ink[index].bottom)).toBeLessThan(1);
 }
 expect(errors).toEqual([]);
});
