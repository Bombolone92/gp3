import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const folder='tests/fixtures/paragraph-gap-rounding/';
test('native paragraph gaps and empty-line transitions retain measured origins',async({page},info)=>{
 test.setTimeout(90000);
 const source=readFileSync(folder+'control.docx'),reference=JSON.parse(readFileSync(folder+'reference.json'));
 expect(createHash('sha256').update(source).digest('hex')).toBe(reference.sourceSha256);
 expect(createHash('sha256').update(readFileSync(folder+'cases.json')).digest('hex')).toBe(reference.casesSha256);
 for(const c of reference.cases)expect(createHash('sha256').update(readFileSync(folder+`page-${c.page+1}.emf`)).digest('hex')).toBe(c.captureSha256);
 await page.goto('/playground.html');await page.getByRole('textbox',{name:'Document text'}).waitFor();
 const lines=await page.evaluate(async encoded=>{
  const{openCanvasDocument,CanvasEditor}=await import('/tools/reviewed-family-modules.js');
  const{pkg,images}=await openCanvasDocument(Uint8Array.from(atob(encoded),c=>c.charCodeAt(0)));
  const host=document.createElement('div');document.body.append(host);const editor=new CanvasEditor(host,{...pkg,images});
  try{return{pages:editor.layout.pages.length,readOnly:editor.readOnly,lines:editor.layout.lines.map(l=>({page:l.page,text:l.fragments.map(f=>f.text||'').join('').trim(),baselinePt:l.baseline*.75,heightPt:l.height*.75,ascentPt:l.ascent*.75,descentPt:l.descent*.75}))};}finally{editor.destroy();host.remove();}
 },source.toString('base64'));
 expect(lines.readOnly).toBe(false);expect(lines.pages).toBe(60);
 const comparisons=reference.cases.map(c=>{
  const rows=lines.lines.filter(l=>l.page===c.page&&l.text);
  expect(rows.map(r=>r.text)).toEqual(c.labels);
  return{...c,actual:rows,errorsPt:rows.map((r,i)=>r.baselinePt-c.baselinesPt[i]),intervalErrorPt:(rows.at(-1).baselinePt-rows[0].baselinePt)-(c.baselinesPt.at(-1)-c.baselinesPt[0])};
 });
 writeFileSync(info.outputPath('comparison.json'),JSON.stringify(comparisons,null,2));
 for(const c of comparisons){
  for(const error of c.errorsPt)expect(Math.abs(error),`${c.family}/${c.after}/${c.variant}`).toBeLessThan(.2);
  expect(Math.abs(c.intervalErrorPt),`${c.family}/${c.after}/${c.variant}`).toBeLessThan(.2);
  const pair=comparisons.find(p=>p.family===c.family&&p.after===c.after&&p.variant!==c.variant);
  expect(pair.baselinesPt[0]).toBe(c.baselinesPt[0]);expect(pair.baselinesPt.at(-1)).toBe(c.baselinesPt.at(-1));
  expect(pair.actual[0].baselinePt).toBe(c.actual[0].baselinePt);expect(pair.actual.at(-1).baselinePt).toBe(c.actual.at(-1).baselinePt);
 }
});
