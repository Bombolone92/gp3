import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {unzipSync,zipSync,strFromU8,strToU8} from 'fflate';
import {createHash} from 'node:crypto';
const folder='tests/fixtures/cell-text-direction';
for(const name of ['control','swapped','zero','thick']) test(`rotated cell coordinate mapping matches the native reference: ${name}`,async({page})=>{
 const reference=JSON.parse(readFileSync(`${folder}/${name==='control'?'reference':name+'-reference'}.json`));
 for(const [file,hash] of Object.entries(reference.hashes)) expect(createHash('sha256').update(readFileSync(`${folder}/${file}`)).digest('hex')).toBe(hash);
 // Measurement-only diagnostic: retain the production import guard until the
 // row allocation, painting, caret and serialization paths are integrated.
 const parts=unzipSync(readFileSync(`${folder}/${name}.docx`));
 parts['word/document.xml']=strToU8(strFromU8(parts['word/document.xml']).replace(/<w:textDirection\b[^>]*\/>/g,''));
 await page.goto('/playground.html');
 const actual=await page.evaluate(async bytes=>{
  const {DocxPackage}=await import('/src/engine/docx.js');const {layoutDocument}=await import('/src/engine/layout.js');const {pageGeometry}=await import('/src/engine/page-settings.js');const {loadCanvasFonts,measureCanvasText}=await import('/src/engine/canvas-text.js');
  const {rotatedCellFrame,cellTextPoint,cellTextLocalPoint}=await import('/src/engine/cell-text-direction.js');
  const p=await DocxPackage.open(Uint8Array.from(atob(bytes),c=>c.charCodeAt(0)));await loadCanvasFonts(p);const ctx=document.createElement('canvas').getContext('2d'),measure=(t,s)=>measureCanvasText(ctx,t,s);
  const normal=layoutDocument(p.paragraphs,measure,pageGeometry(p.pageSettings),p.numbering,p.tables);
  return p.tables.flatMap((table,index)=>table.rows[0].cells.slice(1).map((cell,k)=>{
   const box=normal.cells.find(c=>c.id===cell.id),direction=k===0?'btLr':'tbRl',frame=rotatedCellFrame(box,direction);
   const paragraphs=p.paragraphs.filter(q=>q.cellId===cell.id).map(q=>({...q,cellId:undefined}));
   const local=layoutDocument(paragraphs,measure,{width:frame.width,height:1e6,left:0,right:0,top:0,bottom:0,tableDepth:1});
   const {matrix}=rotatedCellFrame(box,direction,cell.vertical,local.endY);
   return {page:index,direction,lines:local.lines.map(l=>{const point=cellTextPoint(matrix,l.stops[0].x,l.baseline),inverse=cellTextLocalPoint(matrix,point.x,point.y);return {text:l.fragments.map(f=>f.text).join('').trim(),x:point.x*.75,y:point.y*.75,error:Math.abs(inverse.x-l.stops[0].x)+Math.abs(inverse.y-l.baseline)}})};
  }));
 },Buffer.from(zipSync(parts)).toString('base64'));
 for(const c of actual){const p=reference.pages[c.page],sign=c.direction==='btLr'?1:-1,native=p.runs.filter(r=>r.tm[1]*sign>.9);expect(c.lines).toHaveLength(native.length);c.lines.forEach((l,i)=>{expect(l.text).toBe(native[i].text.trim());expect(Math.abs(l.x-native[i].tm[4])).toBeLessThan(.15);expect(Math.abs(l.y-(p.height-native[i].tm[5]))).toBeLessThan(.2);expect(l.error).toBeLessThan(1e-6);});}
});
