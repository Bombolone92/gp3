import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

test.use({permissions:['local-fonts']});
test('matches native horizontal script origins across font faces',async({page},info)=>{
 test.setTimeout(120000);
 const folder='tests/fixtures/script-size/',source=readFileSync(folder+'control.docx');
 const reference=JSON.parse(readFileSync(folder+'reference.json'));
 expect(createHash('sha256').update(source).digest('hex')).toBe(reference.sourceSha256);
 expect(createHash('sha256').update(readFileSync(folder+'native.pdf')).digest('hex')).toBe(reference.pdfSha256);
 await page.goto('/playground.html');
 const rows=await page.evaluate(async bytes=>{
  const {DocxPackage}=await import('/src/engine/docx.js');
  const {loadCanvasFonts,measureCanvasText}=await import('/src/engine/canvas-text.js');
  const {layoutDocument}=await import('/src/engine/layout.js');
  const {pageGeometry}=await import('/src/engine/page-settings.js');
  const pkg=await DocxPackage.open(Uint8Array.from(bytes));await loadCanvasFonts(pkg);
  const ctx=document.createElement('canvas').getContext('2d');
  const layout=layoutDocument(pkg.paragraphs,(t,s)=>measureCanvasText(ctx,t,s),pageGeometry(pkg.pageSettings),pkg.numbering,pkg.tables,pkg.pageStories,{styles:pkg.styles});
  return layout.lines.flatMap(line=>line.fragments.filter(f=>f.text==='TEST').map(f=>{
   const prefix=line.fragments.find(r=>r.text==='START ');
   return {page:line.page,size:f.fontSize,script:f.verticalAlign,
    origin:(f.x+(f.textTransform?.offsetX||0))*.75,advanceOrigin:f.x*.75,offset:(f.textTransform?.offsetX||0)*.75,
    noKerningOrigin:prefix?(prefix.x+measureCanvasText(ctx,prefix.text,{...prefix,kerning:0}).width)*.75:null,
    family:prefix?.fontFamily,kerning:prefix?.kerning,legacy:prefix?.legacyKerning};
  }));
 },[...source]);
 expect(rows).toHaveLength(108);
 const comparisons=reference.cases.flatMap((c,page)=>c.rows.map(expected=>{
  const actual=rows.find(r=>r.page===page&&r.size===expected.size&&r.script===expected.script);
  expect(actual).toBeTruthy();return {family:c.family,face:c.face,...actual,nativeOrigin:expected.scriptX,error:actual.origin-expected.scriptX};
 }));
 writeFileSync(info.outputPath('origins.json'),JSON.stringify(comparisons,null,2));
 // Horizontal origins are independently measured. Vertical script placement
 // remains a separate unresolved native discrepancy.
 for(const row of comparisons)expect(Math.abs(row.error),`${row.family} ${row.face} ${row.size} ${row.script}`).toBeLessThan(.2);
});
