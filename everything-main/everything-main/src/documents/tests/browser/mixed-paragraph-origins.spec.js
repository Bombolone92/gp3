import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const folder='tests/fixtures/mixed-paragraph-origins/';

test('mixed-size manual breaks and following paragraphs retain native origins',async({page},info)=>{
 const source=readFileSync(folder+'control.docx'),reference=JSON.parse(readFileSync(folder+'reference.json'));
 const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
 expect(sha(source)).toBe(reference.sourceSha256);
 expect(sha(readFileSync(folder+'cases.json'))).toBe(reference.casesSha256);
 for(const c of reference.cases)expect(sha(readFileSync(folder+`page-${c.page+1}.emf`))).toBe(c.captureSha256);
 await page.goto('/playground.html');await page.getByRole('textbox',{name:'Document text'}).waitFor();
 const actual=await page.evaluate(async encoded=>{
  const{openCanvasDocument,CanvasEditor}=await import('/tools/reviewed-family-modules.js');
  const{pkg,images}=await openCanvasDocument(Uint8Array.from(atob(encoded),c=>c.charCodeAt(0)));
  const host=document.createElement('div');document.body.append(host);const editor=new CanvasEditor(host,{...pkg,images});
  try{return{pages:editor.layout.pages.length,readOnly:editor.readOnly,origins:editor.layout.lines.flatMap(l=>l.fragments.filter(f=>f.text?.trim()).map(f=>({page:l.page,text:f.text.trim(),baselinePt:l.baseline*.75,size:f.fontSize,heightPt:l.height*.75})))};}finally{editor.destroy();host.remove();}
 },source.toString('base64'));
 expect(actual.readOnly).toBe(false);expect(actual.pages).toBe(36);
 const comparison=reference.cases.map(c=>{
  const rows=actual.origins.filter(r=>r.page===c.page);expect(rows.map(r=>r.text)).toEqual(c.labels);
  return{...c,actual:rows,errorsPt:rows.map((r,i)=>r.baselinePt-c.origins[i].baselinePt)};
 });
 writeFileSync(info.outputPath('comparison.json'),JSON.stringify(comparison,null,2));
 for(const c of comparison)for(const error of c.errorsPt)expect(Math.abs(error),`${c.family}/mark ${c.markSize}/after ${c.after}/prefix ${c.prefix}`).toBeLessThan(.2);
});
