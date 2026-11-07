import { chromium } from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const [sourceRoot, output] = process.argv.slice(2);
if (!sourceRoot || !output) throw new Error('Usage: node tools/audit-drawing-text.mjs SOURCE_DIRECTORY OUTPUT_JSON (Vite must be running on 5173)');
const inventory=JSON.parse(readFileSync('docs/evidence/drawing-text-source-inventory-2026-10-03.json'));
const browser=await chromium.launch({channel:'chrome',headless:true});
const result={scope:'Current parsed drawing-frame eligibility and no-edit transaction audit; not rendering fidelity or in-place editing certification.',rows:[]};
try {
 const page=await browser.newPage(); await page.goto('http://127.0.0.1:5173/playground.html');
 for(const row of inventory.rows){
  const bytes=readFileSync(sourceRoot+'/'+row.file);
  const sha256=createHash('sha256').update(bytes).digest('hex'); if(sha256!==row.sha256)throw Error('Changed corpus source');
  const data=await page.evaluate(async encoded=>{
   const bytes=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));
   const {openCanvasDocument}=await import('/src/engine/open-document.js');
   const {pkg,images}=await openCanvasDocument(bytes);
   try {
    const frames=[];
    const stories=[['word/document.xml',pkg.paragraphs],...Object.entries(pkg.pageStories?.stories||{}).map(([path,s])=>[path,s.paragraphs])];
    for(const [part,paragraphs] of stories)for(const p of paragraphs||[])for(const r of p.runs)if(r.image){
     for(const frame of pkg.drawingTextFrames(r.image)){
      let noEdit=null,error=null;
      if(!pkg.readOnly&&!frame.reason)try{noEdit=pkg.prepareDrawingTextEdit(r.image,frame.index,frame.paragraphs,pkg.assets,pkg.styles,pkg.numbering,frame.tables)===null;}catch(e){error=e.message;}
      frames.push({part,index:frame.index,reason:frame.reason||null,paragraphs:frame.paragraphs.length,tables:frame.tables.length,fields:frame.paragraphs.flatMap(p=>p.runs).filter(r=>r.field).length,controls:frame.paragraphs.flatMap(p=>p.runs).filter(r=>r.contentControl).length,pictures:frame.paragraphs.flatMap(p=>p.runs).filter(r=>r.image).length,noEdit,error});
     }
    }
    return {readOnly:!!pkg.readOnly,issues:pkg.previewIssues||[],frames};
   }finally{for(const b of images.values())b.close();}
  },bytes.toString('base64'));
  result.rows.push({file:row.file,sha256,...data});writeFileSync(output,JSON.stringify(result,null,2));
 }
 console.log(JSON.stringify({files:result.rows.length,frames:result.rows.flatMap(r=>r.frames).length,reasons:result.rows.flatMap(r=>r.frames).filter(f=>f.reason).map(f=>f.reason),errors:result.rows.flatMap(r=>r.frames).filter(f=>f.error)}));
}finally{await browser.close();}
