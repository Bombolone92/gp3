import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

for(const root of ['tests/fixtures/numbering-tracking-alignment/','tests/fixtures/numbering-mark-tracking-alignment/']){
 test(`native numbering alignment retains ${root.includes('mark-tracking')?'paragraph-mark':'level'} character spacing`,async({page},info)=>{
  test.setTimeout(120000);
  const reference=JSON.parse(readFileSync(root+'reference.json')),source=readFileSync(root+'control.docx');
  expect(createHash('sha256').update(source).digest('hex')).toBe(reference.sourceSha256);
  expect(createHash('sha256').update(readFileSync(root+'cases.json')).digest('hex')).toBe(reference.casesSha256);
  await page.goto('/playground.html');await page.getByRole('textbox',{name:'Document text'}).waitFor();
  const result=await page.evaluate(async encoded=>{
   const{openCanvasDocument,CanvasEditor}=await import('/tools/reviewed-family-modules.js');
   const{pkg,images}=await openCanvasDocument(Uint8Array.from(atob(encoded),c=>c.charCodeAt(0)));
   const host=document.createElement('div');document.body.append(host);const editor=new CanvasEditor(host,{...pkg,images});
   try{return{pages:editor.layout.pages.length,rows:editor.layout.lines.map(l=>({page:l.page,text:l.fragments.map(f=>f.text).join(''),
    marker:l.marker?{text:l.marker.text,x:l.marker.x*.75,tracking:l.marker.characterSpacing}:null,textX:l.fragments[0].x*.75}))};}
   finally{editor.destroy();host.remove();}
  },source.toString('base64'));
  writeFileSync(info.outputPath('layout.json'),JSON.stringify(result,null,2)+'\n');
  expect(result.pages).toBe(12);expect(result.rows).toHaveLength(108);
  for(const c of reference.cases){
   const row=result.rows[c.index];expect(row.page).toBe(c.page);expect(row.text).toBe(c.text);expect(row.marker.text).toBe(c.label);
   expect(row.marker.tracking).toBe(c.trackingPt);
   expect(Math.abs(row.marker.x-c.markerXPt)).toBeLessThan(.07);expect(Math.abs(row.textX-c.textXPt)).toBeLessThan(.07);
  }
 });
}
