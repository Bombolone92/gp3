// Offline candidate check. Production modules and source DOCX stay unchanged.
import {chromium} from '@playwright/test';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

const [output,baseURL='http://127.0.0.1:5173']=process.argv.slice(2);
if(!output)throw Error('Usage: node tools/investigate-rotated-screen-origin.mjs OUTPUT_DIRECTORY [BASE_URL]');
const root=fileURLToPath(new URL('../',import.meta.url));
const source=resolve(root,'tests/fixtures/cell-text-direction/live-screen/control.docx');
const bytes=readFileSync(source),hash=b=>createHash('sha256').update(b).digest('hex');
const modulePath=resolve(root,'src/engine/canvas-cell-text.js'),module=readFileSync(modulePath,'utf8');
const needle='  context.transform(...physical.cellText.matrix);';
if(module.split(needle).length!==2)throw Error('Candidate transform site changed');
const candidate=module.replace(needle,needle+'\n  const m=context.getTransform(); context.setTransform(m.a,m.b,m.c,m.d,Math.round(m.e),Math.round(m.f));');
mkdirSync(output,{recursive:true});
const manifest={engineRevision:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
 sourceSha256:hash(bytes),moduleSha256:hash(readFileSync(modulePath)),
 candidate:'Nearest-integer device translation of the composed rotated-cell frame, before painting local content.',
 scope:'Isolated authored two-page control at 100%, 200% and 500%; not general fidelity, editing or performance validation.',rows:[]};
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 for(const variant of ['current','snap-origin']){
  const context=await browser.newContext();
  try{
   if(variant==='snap-origin')await context.route('**/src/engine/canvas-cell-text.js*',route=>route.fulfill({status:200,contentType:'text/javascript',body:candidate}));
   const page=await context.newPage();await page.goto(new URL('/playground.html',baseURL).href,{timeout:180000});
   const rows=await page.evaluate(async bytes=>{
    const {DocxPackage}=await import('/src/engine/docx.js');const {CanvasEditor}=await import('/src/engine/canvas-editor.js');const {loadCanvasFonts}=await import('/src/engine/canvas-text.js');
    const pkg=await DocxPackage.open(new Uint8Array(bytes));await loadCanvasFonts(pkg);const host=document.createElement('div');document.body.append(host);const editor=new CanvasEditor(host,pkg);
    try{return [1,2,5].map(scale=>{const canvases=editor.layout.pages.map(g=>{const c=document.createElement('canvas');c.width=Math.round(g.width*scale);c.height=Math.round(g.height*scale);return c;});editor.paint({canvases,interactive:false});return {zoomPercent:scale*100,pages:canvases.length,pictures:canvases.map(c=>c.toDataURL().split(',')[1])};});}
    finally{editor.destroy();host.remove();}
   },[...bytes]);
   for(const row of rows){
    const pictures=row.pictures.map((data,page)=>{const name=`${variant}-${page}-${row.zoomPercent}.png`,png=Buffer.from(data,'base64');writeFileSync(resolve(output,name),png);return {name,sha256:hash(png)};});
    manifest.rows.push({variant,zoomPercent:row.zoomPercent,pages:row.pages,pictures});
   }
  }finally{await context.close();}
 }
 if(hash(readFileSync(source))!==manifest.sourceSha256||hash(readFileSync(modulePath))!==manifest.moduleSha256)throw Error('Read-only source or production module changed during capture');
 writeFileSync(resolve(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
 console.log(JSON.stringify({rows:manifest.rows.length,sourceSha256:manifest.sourceSha256}));
}finally{await browser.close();}
