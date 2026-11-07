// Run from src/documents: node tools/probe-svg-vector-paint-surface.mjs FRESH.json
// Diagnostic only; scoped original native color controls and isolated browser routes.
// Diagnostic only: route the retained rejected candidate without changing files.
// Requires an already-running local preview. No corpus artwork or fonts are read.
import {chromium} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {unzipSync} from 'fflate';
const external=false;
const output=process.argv[2];if(!output)throw Error('Run from src/documents with a fresh output JSON path');
const folder=`tests/fixtures/${external?'svg-external-backdrop':'svg-backdrop-compositing'}/`;
const sourceCases=JSON.parse(readFileSync(folder+'cases.json'));
const reference=JSON.parse(readFileSync(folder+'native-colors.json','utf8').replace(/^\uFEFF/,''));
const cases=external?reference.samples.flatMap(s=>sourceCases.map(c=>({...c,background:s.background}))):sourceCases;
const nativeColors=external?reference.samples.flatMap(s=>s.colors):reference.colors;
const hashes={};
const bound=external?Object.entries(reference.hashes):[['control.docx','sourceSha256'],['cases.json','casesSha256'],['native.emf','nativeSha256'],['capture.emf','captureSha256'],['gdi.png','gdiSha256']];
for(const [file,key] of bound) {
 hashes[file]=createHash('sha256').update(readFileSync(folder+file)).digest('hex');
 assert.equal(hashes[file],external?key:reference[key],file);
}
const bytes=[...unzipSync(readFileSync(folder+'control.docx'))['word/media/vector.svg']];
const candidate={};
const patch=readFileSync('tests/fixtures/svg-vector-opacity-precision/rejected-alpha-only.patch','utf8').replaceAll('\r\n','\n');
for(const block of patch.split(/(?=^--- a\/)/m)) {
 if(!block.startsWith('--- a/'))continue;
 const path=block.split('\n')[0].slice(6);
 assert.match(path,/^src\/engine\/svg-(group-opacity|word-opacity|word-strokes)\.js$/);
 let source=readFileSync(path,'utf8').replaceAll('\r\n','\n');
 for(const hunk of block.split(/^@@.*?@@.*\n/m).slice(1)) {
  const lines=hunk.split('\n');
  const old=lines.filter(l=>l.startsWith(' ')||l.startsWith('-')).map(l=>l.slice(1)).join('\n');
  const replacement=lines.filter(l=>l.startsWith(' ')||l.startsWith('+')).map(l=>l.slice(1)).join('\n');
  assert.ok(old.length>0&&source.includes(old),`Stale candidate context: ${path}`);
  assert.equal(source.indexOf(old),source.lastIndexOf(old),`Ambiguous candidate context: ${path}`);
  source=source.replace(old,replacement);
 }
 candidate[path.split('/').pop()]=source;
}
assert.equal(Object.keys(candidate).length,3);

const browser=await chromium.launch({channel:'msedge',headless:true});
const results={hashes,paths:{}};
try{
 for(const mode of ['baseline','alpha','filter']){
  const context=await browser.newContext();
  try{
   if(mode!=='baseline')await context.route('**/src/engine/svg-*.js*',route=>{
    const name=new URL(route.request().url()).pathname.split('/').pop();
    let body=candidate[name];
    if(body&&mode==='filter'&&name==='svg-native-opacity.js'){
     body=body.replace('node.style.fillOpacity = String(fill);',"node.style.fillOpacity = String(fill); if(fill>0&&fill<1&&getComputedStyle(node).filter==='none')node.style.filter='opacity(1)';");
    }
    return body?route.fulfill({contentType:'text/javascript',body}):route.continue();
   });
   const page=await context.newPage();await page.goto('http://127.0.0.1:5173/playground.html');await page.evaluate(async mode=>{
    const{nativeSvgAlpha,nativeSvgOpacities}=await import('/src/engine/svg-native-opacity.js');
    const{nativeSvgStrokes}=await import('/src/engine/svg-native-strokes.js');
    if(Math.abs(nativeSvgAlpha(.2,1)-(mode==='baseline'?.2:50/255))>1e-12||nativeSvgOpacities.length!==(mode==='baseline'?1:2))throw Error('Wrong baseline/candidate modules');
    if(nativeSvgStrokes.toString().includes('nativeSvgOpacities(svg,paintOpacity)')!==(mode!=='baseline'))throw Error('Wrong stroke preparation module');
   },mode);
   results.paths[mode]=await page.evaluate(async({bytes,cases})=>{
    const {decodeSvg}=await import('/src/engine/svg-images.js');const start=performance.now(),image=await decodeSvg(new Uint8Array(bytes));
    try{const c=document.createElement('canvas');c.width=1200;c.height=900;const ctx=c.getContext('2d');ctx.drawImage(image,0,0,1200,900);
     return {elapsedMs:performance.now()-start,colors:cases.map(({row,column})=>[...ctx.getImageData(column*300+150,row*100+50,1,1).data].slice(0,3))};
    }finally{image.close();}
   },{bytes,cases});
  }finally{await context.close();}
 }
 for(const path of Object.values(results.paths)){
  path.differences=path.colors.flatMap((actual,i)=>actual.some((v,j)=>v!==nativeColors[i][j])?[{case:i,actual,native:nativeColors[i]}]:[]);
  path.matches=cases.length-path.differences.length;
 }
 writeFileSync(output,JSON.stringify({scope:'Rejected identity paint-surface probe: native centers only, no renderer mutation. Single elapsed times are not performance evidence; see paired rejection evidence.',browserVersion:browser.version(),...results},null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify(Object.fromEntries(Object.entries(results.paths).map(([k,v])=>[k,{matches:v.matches,elapsedMs:v.elapsedMs,differences:v.differences}]))));
}finally{await browser.close();}
