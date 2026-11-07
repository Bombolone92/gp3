import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root='tests/fixtures/mixed-paragraph-metrics/';

test('empty paragraphs and inline pictures retain native transition spacing',async({page},info)=>{
 test.setTimeout(120000);
 const reference=JSON.parse(readFileSync(root+'reference.json'));
 const source=readFileSync(root+'control.docx');
 expect(createHash('sha256').update(source).digest('hex')).toBe(reference.sourceSha256);
 expect(createHash('sha256').update(readFileSync(root+'cases.json')).digest('hex')).toBe(reference.casesSha256);
 await page.goto('/playground.html');
 await page.getByRole('textbox',{name:'Document text'}).waitFor();
 const layout=await page.evaluate(async encoded=>{
  const {openCanvasDocument,CanvasEditor}=await import('/tools/reviewed-family-modules.js');
  const {pkg,images}=await openCanvasDocument(Uint8Array.from(atob(encoded),c=>c.charCodeAt(0)));
  const host=document.createElement('div');document.body.append(host);const editor=new CanvasEditor(host,{...pkg,images});
  try{return {pages:editor.layout.pages.length,lines:editor.layout.lines.map(l=>({page:l.page,text:l.fragments.map(f=>f.text||'').join('').trim().replace(/^\ufffc/,''),baseline:l.baseline*.75}))};}
  finally{editor.destroy();host.remove();}
 },source.toString('base64'));
 writeFileSync(info.outputPath('layout.json'),JSON.stringify(layout,null,2)+'\n');
 expect(layout.pages).toBe(96);expect(layout.lines).toHaveLength(384);
 for(const c of reference.cases){
  const rows=layout.lines.filter(l=>l.page===c.page&&l.text.startsWith('Aa'));
  expect(rows.map(r=>r.text)).toEqual(c.labels);
  rows.forEach((r,i)=>{
   expect(Math.abs(r.baseline-c.baselinesPt[i])).toBeLessThan(.2);
   expect(Math.abs((r.baseline-rows[0].baseline)-(c.baselinesPt[i]-c.baselinesPt[0]))).toBeLessThan(.1);
  });
 }
});
