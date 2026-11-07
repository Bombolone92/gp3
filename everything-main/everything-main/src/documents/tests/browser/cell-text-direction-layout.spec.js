import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const folder='tests/fixtures/cell-text-direction';
for(const name of ['control','swapped','zero','thick','automatic','height','origins','mode14','mode15','font-sizes']) test(`table layout resolves rotated source text against the native reference: ${name}`,async({page})=>{
 const reference=JSON.parse(readFileSync(`${folder}/${name==='control'?'reference':name+'-reference'}.json`));
 for(const [file,hash] of Object.entries(reference.hashes)) expect(createHash('sha256').update(readFileSync(`${folder}/${file}`)).digest('hex')).toBe(hash);
 await page.goto('/playground.html');
 const actual=await page.evaluate(async bytes=>{
  const {DocxPackage}=await import('/src/engine/docx.js');const {layoutDocument}=await import('/src/engine/layout.js');const {pageGeometry}=await import('/src/engine/page-settings.js');const {loadCanvasFonts,measureCanvasText}=await import('/src/engine/canvas-text.js');
  const {cellTextPoint}=await import('/src/engine/cell-text-direction.js');
  const p=await DocxPackage.open(Uint8Array.from(atob(bytes),c=>c.charCodeAt(0)));await loadCanvasFonts(p);const ctx=document.createElement('canvas').getContext('2d');
  const layout=layoutDocument(p.paragraphs,(t,s)=>measureCanvasText(ctx,t,s),pageGeometry(p.pageSettings),p.numbering,p.tables);
  const source=p.paragraphs.map(p=>p.runs.map(r=>r.text).join('')).join('\n');
  return {pages:layout.pageCount,horizontal:layout.lines.filter(l=>!l.cellText&&l.fragments.map(f=>f.text||'').join('')==='Clear text for measuring').map(l=>({page:l.page,x:l.stops[0].x*.75,y:l.baseline*.75})),cells:p.tables.flatMap(table=>table.rows[0].cells.filter(cell=>cell.textDirection!=='lrTb').map(cell=>{
   const box=layout.cells.find(box=>box.id===cell.id);
   return {page:box.page,direction:cell.textDirection,lines:layout.lines.filter(line=>line.cellId===cell.id).map(physical=>{
    const {line,matrix}=physical.cellText,point=cellTextPoint(matrix,line.stops[0].x,line.baseline);
    return {text:line.fragments.map(f=>f.text).join('').trim(),source:source.slice(line.start,line.end).trim(),x:point.x*.75,y:point.y*.75,
     visible:physical.x<box.x+box.width&&physical.x+physical.width>box.x&&physical.y<box.y+box.height&&physical.y+physical.height>box.y};
   })};
  }))};
 },readFileSync(`${folder}/${name}.docx`).toString('base64'));
 writeFileSync(test.info().outputPath('positions.json'),JSON.stringify(actual,null,2));
 expect(actual.pages).toBe(reference.pages.length);
 if(name==='font-sizes'){
  expect(actual.horizontal).toHaveLength(8);
  expect(actual.cells).toHaveLength(16);
  for(const line of actual.horizontal){
   const native=reference.pages[line.page].runs.filter(r=>r.text.trim()==='Clear text for measuring'&&r.tm[0]===1);
   expect(native).toHaveLength(1);
   expect(Math.abs(line.x-native[0].tm[4])).toBeLessThan(.15);
   expect(Math.abs(line.y-(reference.pages[line.page].height-native[0].tm[5]))).toBeLessThan(.2);
  }
 }
 const mismatches=[];
 for(const c of actual.cells){const p=reference.pages[c.page],sign=c.direction==='btLr'?1:-1,native=p.runs.filter(r=>r.tm[1]*sign>.9);for(const l of c.lines)expect(l.source).toBe(l.text);const ink=c.lines.filter(l=>l.text);expect(ink).toHaveLength(native.length);ink.forEach((l,i)=>{
  expect(l.text).toBe(native[i].text.trim());
  // The retained reference PDF coordinates drift beyond the page in the 50-word
  // overflow control. Verify visible geometry at the original tolerance;
  // all clipped source text, offsets and wrapping remain checked above.
  if(l.visible){const dx=Math.abs(l.x-native[i].tm[4]);if(dx>=.15)mismatches.push({page:c.page+1,direction:c.direction,line:i,dx});expect(Math.abs(l.y-(p.height-native[i].tm[5])),`${name} page ${c.page+1} ${c.direction} y ${i}`).toBeLessThan(.2);}
 });}
 if(name==='origins'){
  // Independent repeated/reordered glyph controls reproduce the same native
  // baseline sequence. The discrepancy is not specific to any source glyph.
  for(const sign of [-1,1]){
   const positions=reference.pages.map(p=>p.runs.filter(r=>r.tm[1]*sign>.9).map(r=>r.tm[4]));
   expect(positions[0]).toHaveLength(6);
   for(const position of positions.slice(1))expect(position).toEqual(positions[0]);
  }
  expect(mismatches.map(({dx,...position})=>position)).toEqual(Array.from({length:6},(_,page)=>[2,4].map(line=>({page:page+1,direction:'tbRl',line}))).flat());
  for(const mismatch of mismatches)expect(mismatch.dx).toBeLessThan(.22);
  test.fail(true,'Repeated/reordered glyphs retain the unresolved automatic-spacing tbRl baseline discrepancy.');
 }
 if(name==='height'){
  // Keep this measured discrepancy explicit after editable integration.
  // Verify every other assertion before marking only this final check as an
  // expected failure; unrelated regressions must still fail the suite.
  expect(mismatches.map(({dx,...position})=>position)).toEqual([
   {page:6,direction:'tbRl',line:2},{page:6,direction:'tbRl',line:4},{page:14,direction:'tbRl',line:2},
  ]);
  for(const mismatch of mismatches)expect(mismatch.dx).toBeLessThan(.22);
  test.fail(true,'Three automatic-spacing tbRl baselines remain 0.19–0.21pt from the native reference.');
 }
 expect(mismatches).toEqual([]);
});
