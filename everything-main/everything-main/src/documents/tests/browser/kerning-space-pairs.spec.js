import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
test.use({permissions:['local-fonts']});
async function positions(page,source,folder){
 const bytes=readFileSync(source),reference=JSON.parse(readFileSync(folder+'reference.json'));
 const hash=b=>createHash('sha256').update(b).digest('hex');
 expect(hash(bytes)).toBe(reference.sourceSha256);expect(hash(readFileSync(folder+'native.pdf'))).toBe(reference.pdfSha256);
 await page.goto('/playground.html');
 const actual=await page.evaluate(async encoded=>{
  const {DocxPackage}=await import('/src/engine/docx.js'),{validateCanvasLayout,measureCanvasText}=await import('/src/engine/canvas-text.js');
  const {layoutDocument}=await import('/src/engine/layout.js'),{pageGeometry}=await import('/src/engine/page-settings.js');
  const {localFamilyMetadata}=await import('/src/engine/local-fonts.js');
  const pkg=await DocxPackage.open(Uint8Array.from(atob(encoded),c=>c.charCodeAt(0)));await validateCanvasLayout(pkg);
  const ctx=document.createElement('canvas').getContext('2d'),layout=layoutDocument(pkg.paragraphs,(t,s)=>measureCanvasText(ctx,t,s),pageGeometry(pkg.pageSettings));
  return {installed:(await localFamilyMetadata('Rockwell')).length>0,lines:layout.lines.map(l=>({page:l.page,x:l.fragments[0].x*.75,y:792-l.baseline*.75,text:l.fragments.map(f=>f.text).join('')}))};
 },bytes.toString('base64'));
 test.skip(!actual.installed,'Requires authorized installed Rockwell pair data.');
 expect(actual.lines).toHaveLength(reference.lines.length);
 for(const [i,row]of actual.lines.entries()){
  expect(row.text.replace(/\s/g,'')).toBe(reference.lines[i].text.replace(/\s/g,''));
  expect(row.page).toBe(reference.lines[i].page||0);
  expect(Math.abs(row.y-reference.lines[i].y),`${i} baseline`).toBeLessThan(.2);
 }
 return actual.lines.map((row,i)=>Math.abs(row.x-reference.lines[i].x));
}
test('legacy space-pair origins across run and control boundaries',async({page})=>{
 const errors=await positions(page,'public/fixtures/kerning-space-pairs.docx','tests/fixtures/kerning-space-pairs/');
 expect(errors[4]).toBeLessThan(.2);
 expect(Math.max(...errors.slice(0,4))).toBeLessThan(.2);
});
for(const enabled of [false,true])test(`legacy nonbreaking-space variants with kerning ${enabled}`,async({page})=>{
 const folder='tests/fixtures/legacy-space-variants/',cases=JSON.parse(readFileSync(folder+'cases.json'));
 const errors=await positions(page,folder+'control.docx',folder);
 const selected=errors.filter((_,i)=>cases[i].kern===enabled);expect(selected).toHaveLength(24);
 expect(Math.max(...selected)).toBeLessThan(.2);
});
