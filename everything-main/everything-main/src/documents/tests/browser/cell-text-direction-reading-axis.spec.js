import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

test('nested rotated labels retain the same placement as ordinary tables',async({page})=>{
 const folder='tests/fixtures/cell-text-direction/reading-axis/';
 const reference=JSON.parse(readFileSync(folder+'reference.json'));
 for(const [name,hash] of Object.entries(reference.hashes))expect(createHash('sha256').update(readFileSync(folder+name)).digest('hex')).toBe(hash);
 await page.goto('/playground.html');
 const actual=await page.evaluate(async bytes=>{
  const {DocxPackage}=await import('/src/engine/docx.js');
  const {layoutDocument}=await import('/src/engine/layout.js');
  const {pageGeometry}=await import('/src/engine/page-settings.js');
  const {loadCanvasFonts,measureCanvasText}=await import('/src/engine/canvas-text.js');
  const {cellTextPoint}=await import('/src/engine/cell-text-direction.js');
  const pkg=await DocxPackage.open(Uint8Array.from(atob(bytes),c=>c.charCodeAt(0)));
  await loadCanvasFonts(pkg);
  const ctx=document.createElement('canvas').getContext('2d');
  const layout=layoutDocument(pkg.paragraphs,(t,s)=>measureCanvasText(ctx,t,s),pageGeometry(pkg.pageSettings),pkg.numbering,pkg.tables);
  return {pages:layout.pageCount,lines:layout.lines.filter(l=>l.cellText).map(l=>{
   const {line,matrix}=l.cellText,p=cellTextPoint(matrix,line.stops[0].x,line.baseline);
   return {page:l.page,text:line.fragments.map(f=>f.text||'').join('').trim(),x:p.x*.75,y:p.y*.75};
  })};
 },readFileSync(folder+'control.docx').toString('base64'));
 expect(actual.pages).toBe(4);expect(actual.lines).toHaveLength(36);
 const native=reference.pages.map(p=>p.runs.filter(r=>Math.abs(r.tm[1])>.9));
 for(const runs of native)expect(runs).toHaveLength(9);
 // The native reference independently confirms nesting adds no offset for these zero-margin
 // parent cells. Compare ordering as well as geometry, without nearest matching.
 for(const [first,second] of [[0,1],[2,3]]){
  expect(native[first]).toEqual(native[second]);
  expect(actual.lines.filter(l=>l.page===first).map(({page,...l})=>l)).toEqual(actual.lines.filter(l=>l.page===second).map(({page,...l})=>l));
 }
 for(let p=0;p<4;p++)for(const [i,line] of actual.lines.filter(l=>l.page===p).entries()){
  const ref=native[p][i];expect(line.text).toBe(ref.text);
  expect(Math.abs(line.x-ref.tm[4])).toBeLessThan(.15);
  expect(Math.abs(line.y-(reference.pages[p].height-ref.tm[5]))).toBeLessThan(.2);
 }
 // These are PDF-position observations, not a model for changing font widths:
 // translating identical text changes the distance between opposite rotations.
 const impliedAdvance=(p,row)=>native[p][row*3+2].tm[5]-native[p][row*3].tm[5];
 expect(impliedAdvance(0,0)-impliedAdvance(2,0)).toBeCloseTo(.12,6);
 expect(impliedAdvance(0,1)-impliedAdvance(2,1)).toBeCloseTo(.12,6);
});
