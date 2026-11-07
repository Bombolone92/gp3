import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';
const normalize=polys=>{const points=polys.flat(),x=Math.min(...points.map(p=>p[0])),y=Math.min(...points.map(p=>p[1]));return polys.map(poly=>poly.map(([a,b])=>[a-x,b-y]));};
const extent=polys=>[Math.max(...polys.flat().map(p=>p[0])),Math.max(...polys.flat().map(p=>p[1]))];
const ink=(polys,x,y)=>polys.some(poly=>{let inside=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const[a,b]=poly[i],[c,d]=poly[j];if((b>y)!==(d>y)&&x<(c-a)*(y-b)/(d-b)+a)inside=!inside;}return inside;});
const near=(polys,x,y)=>polys.some(poly=>poly.some(([a,b],i)=>{const[c,d]=poly[(i+1)%poly.length],dx=c-a,dy=d-b,t=Math.max(0,Math.min(1,((x-a)*dx+(y-b)*dy)/(dx*dx+dy*dy||1)));return Math.hypot(x-a-t*dx,y-b-t*dy)<.15;}));
const rectangle=([x,y,w,h])=>[[x,y],[x+w,y],[x+w,y+h],[x,y+h]];
for(const folder of ['compound-border-variants','thin-thick-medium'])test(`matches native compound border corners, bands and editable round trips: ${folder}`,async({page},info)=>{
 const reference=JSON.parse(readFileSync(`tests/fixtures/${folder}/reference.json`,'utf8'));
 test.setTimeout(120000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/playground.html');
 const source=`tests/fixtures/${folder}/control.docx`,bytes=readFileSync(source);
 const hash=b=>createHash('sha256').update(b).digest('hex');
 expect(hash(bytes)).toBe(reference.sourceSha256);expect(hash(readFileSync(`tests/fixtures/${folder}/native.pdf`))).toBe(reference.pdfSha256);
 const actual=await page.evaluate(async bytes=>{
  const {DocxPackage}=await import('/src/engine/docx.js'),{layoutDocument}=await import('/src/engine/layout.js'),{pageGeometry}=await import('/src/engine/page-settings.js'),{loadCanvasFonts,measureCanvasText}=await import('/src/engine/canvas-text.js'),{paintParagraphBorder}=await import('/src/engine/canvas-paragraph-borders.js');
  const p=await DocxPackage.open(new Uint8Array(bytes));await loadCanvasFonts(p);
  const context=document.createElement('canvas').getContext('2d');
  const l=layoutDocument(p.paragraphs,(t,s)=>measureCanvasText(context,t,s),pageGeometry(p.pageSettings),p.numbering,p.tables);
  const capture=strokes=>{const polys=[];let path=[];const ctx={save(){},restore(){},beginPath(){path=[];},moveTo(x,y){path.push([x*.75,y*.75]);},lineTo(x,y){path.push([x*.75,y*.75]);},closePath(){},fill(){polys.push(path);},fillRect(x,y,w,h){polys.push([[x,y],[x+w,y],[x+w,y+h],[x,y+h]].map(p=>p.map(v=>v*.75)));}};for(const s of strokes)paintParagraphBorder(ctx,s);return polys;};
  return {pages:l.pageCount,cases:p.tables.map((table,i)=>({paragraph:capture(l.paragraphBorders.filter(s=>s.page===i)),table:capture(l.tableBorders.filter(s=>s.tableId===table.id&&!s.guide))}))};
 },[...bytes]);
 expect(actual.pages).toBe(reference.cases.length);expect(actual.cases).toHaveLength(reference.cases.length);
 for(const c of reference.cases){
  const paths=c.paths.map(p=>p.bounds);
  const horizontal=paths.filter(b=>b[2]>150&&b[3]<20).sort((a,b)=>a[1]-b[1]);
  const divide=(horizontal[3][1]+horizontal[3][3]+horizontal[4][1])/2;
  for(const context of ['paragraph','table']){
   const word=normalize(paths.filter(b=>context==='paragraph'?b[1]<divide:b[1]>divide).map(rectangle));
   const app=normalize(actual.cases[c.page][context]),wa=extent(word),aa=extent(app),diff=[];let checked=0;
   for(const right of [false,true])for(const bottom of [false,true])for(let x=.24;x<20;x+=.36)for(let y=.24;y<20;y+=.36){
    const ax=right?aa[0]-x:x,ay=bottom?aa[1]-y:y,wx=right?wa[0]-x:x,wy=bottom?wa[1]-y:y;
    if(near(app,ax,ay)||near(word,wx,wy))continue;
    if(ink(app,ax,ay)!==ink(word,wx,wy))diff.push({right,bottom,x,y});checked++;
   }
   expect(diff,`${c.style} ${c.size} ${c.frame} ${context}`).toEqual([]);
   expect(checked).toBeGreaterThan(100);
  }
 }
 await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(new RegExp('^'+reference.cases[0].style));await expect(input).toBeEditable();
 const original=await input.inputValue(),parts=unzipSync(bytes);
 const download=async suffix=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(`compound-${suffix}.docx`);await(await pending).saveAs(path);return path;};
 const same=path=>{const out=unzipSync(readFileSync(path));expect(Object.keys(out).sort()).toEqual(Object.keys(parts).sort());for(const[n,b]of Object.entries(parts))expect(Buffer.from(out[n]).equals(Buffer.from(b)),n).toBe(true);};
 same(await download('noedit'));
 await input.focus();await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');const edited=await input.inputValue(),saved=await download('edited');
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);same(await download('undo'));await reopenDocx(page,input,saved,edited);expect(errors).toEqual([]);
});
