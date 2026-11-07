import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root='tests/fixtures/mixed-font-chain/';

test('mixed-size manual-break paragraphs preserve native spacing after empty chains',async({page},info)=>{
 test.setTimeout(120000);
 const reference=JSON.parse(readFileSync(root+'reference.json')),source=readFileSync(root+'control.docx');
 expect(createHash('sha256').update(source).digest('hex')).toBe(reference.sourceSha256);
 expect(createHash('sha256').update(readFileSync(root+'cases.json')).digest('hex')).toBe(reference.casesSha256);
 await page.goto('/playground.html');await page.getByRole('textbox',{name:'Document text'}).waitFor();
 const layout=await page.evaluate(async encoded=>{
  const {openCanvasDocument,CanvasEditor}=await import('/tools/reviewed-family-modules.js');
  const {pkg,images}=await openCanvasDocument(Uint8Array.from(atob(encoded),c=>c.charCodeAt(0)));
  const host=document.createElement('div');document.body.append(host);const editor=new CanvasEditor(host,{...pkg,images});
  try{return {pages:editor.layout.pages.length,lines:editor.layout.lines.map(l=>({page:l.page,baseline:l.baseline*.75,
   fragments:l.fragments.map(f=>({text:f.text,size:f.fontSize,baseline:l.baseline*.75}))}))};}
  finally{editor.destroy();host.remove();}
 },source.toString('base64'));
 writeFileSync(info.outputPath('layout.json'),JSON.stringify(layout,null,2)+'\n');
 expect(layout.pages).toBe(72);expect(layout.lines).toHaveLength(1056);
 const fragments=c=>layout.lines.filter(l=>l.page===c.page).flatMap(l=>l.fragments.filter(f=>f.text?.startsWith('Aa')));
 for(const c of reference.cases){
  const rows=fragments(c);expect(rows.map(r=>r.text)).toEqual(c.labels);
  expect(rows.map(r=>r.size)).toEqual(c.sizes);
  rows.forEach((r,i)=>{
   expect(Math.abs(r.baseline-c.baselinesPt[i])).toBeLessThan(.2);
   expect(Math.abs((r.baseline-rows[0].baseline)-(c.baselinesPt[i]-c.baselinesPt[0]))).toBeLessThan(.2);
  });
 }
 for(let i=0;i<reference.cases.length;i+=2){
  const a=reference.cases[i],b=reference.cases[i+1];
  expect(a.baselinesPt).toEqual(b.baselinesPt);
  expect(fragments(a).map(r=>r.baseline)).toEqual(fragments(b).map(r=>r.baseline));
 }
});
