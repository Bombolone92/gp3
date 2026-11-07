// Diagnostic only: route the retained rejected candidate without changing files.
// Requires an already-running local preview. No corpus artwork or fonts are read.
import {chromium} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {unzipSync} from 'fflate';
import {svgOpacityFloat} from '../src/engine/svg-group-opacity.js';
const external=process.argv.includes('--external');
const fullPixels=process.argv.includes('--pixels');
const outputArgs=process.argv.slice(2);
const rootIndex=outputArgs.indexOf('--root-native');
const rootDirectory=rootIndex>=0?outputArgs[rootIndex+1]:null;
if(rootIndex>=0){assert.ok(rootDirectory&&!rootDirectory.startsWith('--'),'Expected a root-viewport capture directory');outputArgs.splice(rootIndex,2);assert.ok(fullPixels,'Root-viewport comparison requires --pixels');}
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
const rootCaptures=rootDirectory?JSON.parse(readFileSync(rootDirectory+'/manifest.json','utf8')):null;
const rootHashes={};
function nativePng(background){
 if(!rootCaptures)return readFileSync(folder+(external?background+'.png':'gdi.png'));
 const fixture=external?'svg-external-backdrop':'svg-backdrop-compositing';
 const captures=rootCaptures.filter(c=>c.fixture===fixture&&c.background===background);assert.equal(captures.length,1);
 const capture=captures[0];assert.equal(capture.nativeSha256,hashes['native.emf']);
 assert.deepEqual(capture.sourceRect,[0,0,120,90]);assert.deepEqual(capture.destinationRect,[0,0,1200,900]);
 const png=readFileSync(rootDirectory+'/'+fixture+'/'+background+'.png');
 const hash=createHash('sha256').update(png).digest('hex');assert.equal(hash,capture.pngSha256);rootHashes[background]=hash;return png;
}
const nativeImages=fullPixels?Object.fromEntries((external?reference.samples.map(s=>s.background):['FFFFFF']).map(bg=>[bg,'data:image/png;base64,'+nativePng(bg).toString('base64')])):null;
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
const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||'chrome'});
const candidateHashes=Object.fromEntries(Object.entries(candidate).map(([name,body])=>[name,createHash('sha256').update(body).digest('hex')]));
const results={external,hashes,...(rootDirectory?{rootViewportHashes:rootHashes,scope:'Explicit 0,0,120,90 pixel-source playback; correspondence to SVG coordinates unproven. Existing full-frame oracles unchanged. Not native screen or final document placement.'}:{}),candidatePatchSha256:createHash('sha256').update(patch).digest('hex'),candidateHashes,paths:{},routeHits:{},routeRequests:[]};
try {
 for(const mode of ['baseline','alpha','layers','composite']) {
  const context=await browser.newContext();
  try {
   if(mode!=='baseline')await context.route('**/src/engine/svg-*.js*',route=>{
    const name=new URL(route.request().url()).pathname.split('/').pop();
    if(candidate[name]){results.routeHits[name]=(results.routeHits[name]||0)+1;results.routeRequests.push({mode,name,url:route.request().url(),bodySha256:candidateHashes[name]});}
    return candidate[name]?route.fulfill({contentType:'text/javascript',body:candidate[name]}):route.continue();
   });
   const page=await context.newPage();
   await page.goto(process.env.DOCUMENTS_PREVIEW_URL||'http://127.0.0.1:5173/playground.html');
   results.paths[mode]=await page.evaluate(async({bytes,cases,mode,external,nativeImages})=>{
    const {decodeSvg}=await import('/src/engine/svg-images.js');
    const canvas=document.createElement('canvas');canvas.width=1200;canvas.height=900;
    const ctx=canvas.getContext('2d');const images=[],urls=[];let drawCalls=0;
    let baselineImage;
    try {
    if(mode==='layers'||mode==='composite') {
     const {nativeSvgStrokes}=await import('/src/engine/svg-native-strokes.js');
     const doc=new DOMParser().parseFromString(new TextDecoder().decode(new Uint8Array(bytes)),'image/svg+xml');
     const preview=nativeSvgStrokes(doc.documentElement,{width:120,height:90},true);
     const names=[...preview.children].map(n=>n.localName);
     for(let i=0;i<preview.children.length;i++) {
      if(['defs','style','title','desc','clipPath'].includes(names[i]))continue;
      const layer=preview.cloneNode(true);
      [...layer.children].forEach((node,j)=>{if(j!==i&&!['defs','style','title','desc','clipPath'].includes(names[j]))node.remove();});
      const url=URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(layer)],{type:'image/svg+xml'}));
      urls.push(url);const image=new Image();images.push(image);
      image.src=url;await image.decode();
     }
    }else {
     images.push(await decodeSvg(new Uint8Array(bytes)));
    }
    const colors=[],pixels=[];
    if(nativeImages)baselineImage=await decodeSvg(new Uint8Array(bytes));
    for(const background of external?[...new Set(cases.map(c=>c.background))]:[null]) {
     ctx.clearRect(0,0,1200,900);
     let before;
     if(nativeImages){
      ctx.fillStyle='#'+(background||'FFFFFF');ctx.fillRect(0,0,1200,900);
      ctx.drawImage(baselineImage,0,0,1200,900);before=ctx.getImageData(0,0,1200,900).data;
      ctx.clearRect(0,0,1200,900);
     }
     if(background||nativeImages){ctx.fillStyle='#'+(background||'FFFFFF');ctx.fillRect(0,0,1200,900);}
     for(const image of images) {
      // Two separately quantized premultiplied contributions. This experiment
      // proves flat opaque-backdrop centers only, not a general SVG painter.
      if(mode==='composite') {
       ctx.globalCompositeOperation='destination-out';ctx.drawImage(image,0,0,1200,900);drawCalls++;
       ctx.globalCompositeOperation='lighter';
      }
      ctx.drawImage(image,0,0,1200,900);drawCalls++;
      ctx.globalCompositeOperation='source-over';
     }
     if(nativeImages){
      const actual=ctx.getImageData(0,0,1200,900).data;
      const nativeImage=new Image();nativeImage.src=nativeImages[background||'FFFFFF'];await nativeImage.decode();
      if(nativeImage.naturalWidth!==1200||nativeImage.naturalHeight!==900)throw new Error('Unexpected native capture dimensions');
      const nativeCanvas=document.createElement('canvas');nativeCanvas.width=1200;nativeCanvas.height=900;
      const nc=nativeCanvas.getContext('2d');nc.drawImage(nativeImage,0,0);const native=nc.getImageData(0,0,1200,900).data;
      const stats={background:background||'FFFFFF',beforeDiffPixels:0,afterDiffPixels:0,changedPixels:0,improvedPixels:0,worsenedPixels:0,equalErrorChangedPixels:0,beforeL1:0,afterL1:0};
      for(let i=0;i<native.length;i+=4){
       let be=0,ae=0,changed=false;
       for(let j=0;j<4;j++){be+=Math.abs(before[i+j]-native[i+j]);ae+=Math.abs(actual[i+j]-native[i+j]);changed||=before[i+j]!==actual[i+j];}
       stats.beforeL1+=be;stats.afterL1+=ae;if(be)stats.beforeDiffPixels++;if(ae)stats.afterDiffPixels++;
       if(changed){stats.changedPixels++;if(ae<be)stats.improvedPixels++;else if(ae>be)stats.worsenedPixels++;else stats.equalErrorChangedPixels++;}
      }
      const digest=await crypto.subtle.digest('SHA-256',before);
      stats.baselinePixelSha256=[...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,'0')).join('');
      pixels.push(stats);nativeImage.removeAttribute('src');
     }
     for(const {row,column} of cases.filter(c=>!external||c.background===background))
      colors.push([...ctx.getImageData(external?600:column*300+150,row*100+50,1,1).data].slice(0,3));
    }
    return {imageCount:images.length,drawCalls,colors,...(nativeImages?{pixels}:{})};
    }finally{baselineImage?.close();for(const image of images){if(image.close)image.close();else image.removeAttribute('src');}for(const url of urls)URL.revokeObjectURL(url);}
   },{bytes,cases,mode,external,nativeImages});
  }finally{await context.close();}
 }
 for(const mode of ['layers','composite'])assert.equal(results.paths[mode].imageCount,external?10:76);
 assert.equal(results.paths.composite.drawCalls,external?80:152);
 // Vite may request both plain and timestamped module URLs in one context.
 // Verify every patched body and each context instead of assuming one request.
 for(const request of results.routeRequests){
  const url=new URL(request.url);assert.equal(url.pathname,'/src/engine/'+request.name);
  assert.ok(!url.search||/^\?t=\d+$/.test(url.search),'Unexpected candidate module query');
  assert.equal(request.bodySha256,candidateHashes[request.name]);
 }
 for(const mode of ['alpha','layers','composite'])for(const name of Object.keys(candidate))
  assert.ok(results.routeRequests.some(r=>r.mode===mode&&r.name===name),`Missing candidate response: ${mode}/${name}`);
 const rgb=hex=>hex.match(/../g).map(n=>parseInt(n,16));
 const composite=(source,backdrop,opacity)=>{
  const alpha=Math.floor(svgOpacityFloat(opacity)*255)/255;
  return source.map((v,i)=>Math.min(255,Math.round(v*alpha)+Math.round(backdrop[i]*(1-alpha))));
 };
 results.separateByteRounding=cases.map(c=>{
  const color=composite(rgb(c.color),rgb(c.background),c.opacity);
  return c.overlay?composite(rgb(c.overlay.color),color,c.overlay.opacity):color;
 });
 assert.deepEqual(results.separateByteRounding,nativeColors);
 assert.deepEqual(results.paths.composite.colors,nativeColors,'Two-pass flat native center samples');
 if(fullPixels)for(const [mode,path] of Object.entries(results.paths))path.pixels.forEach((p,i)=>{
  assert.equal(p.baselinePixelSha256,results.paths.baseline.pixels[i].baselinePixelSha256,`Changed comparison baseline: ${mode}`);
  assert.equal(p.changedPixels,p.improvedPixels+p.worsenedPixels+p.equalErrorChangedPixels);
 });
 for(const path of Object.values(results.paths)) {
  path.differences=path.colors.flatMap((actual,i)=>actual.some((v,j)=>v!==nativeColors[i][j])?[{...cases[i],actual,native:nativeColors[i]}]:[]);
  path.matches=cases.length-path.differences.length;
 }
 writeFileSync(outputArgs.find(arg=>!['--external','--pixels'].includes(arg))||`.private-svg-${external?'external':'internal'}-backdrop-paths.json`,JSON.stringify(results,null,2)+'\n');
 console.log(JSON.stringify(Object.fromEntries(Object.entries(results.paths).map(([name,path])=>[name,{matches:path.matches,imageCount:path.imageCount,drawCalls:path.drawCalls,...(fullPixels?{pixels:path.pixels}:{})}]))));
}finally{await browser.close();}
