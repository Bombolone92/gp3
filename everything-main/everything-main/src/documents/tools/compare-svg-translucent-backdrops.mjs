import{chromium}from'@playwright/test';
import{readFileSync,writeFileSync}from'node:fs';
import{unzipSync}from'fflate';
import{createHash}from'node:crypto';
import assert from'node:assert/strict';
// Diagnostic only. Uses the retained native EMF, never a new reference application instance.
const f='tests/fixtures/svg-external-backdrop/';
const ref=JSON.parse(readFileSync(process.argv[2]||'.private-svg-translucent-native.json','utf8').replace(/^\uFEFF/,''));
assert.equal(createHash('sha256').update(readFileSync(f+'native.emf')).digest('hex'),ref.nativeSha256);
assert.equal(ref.pixelFormat,'Format32bppPArgb');assert.equal(ref.samples.length,24);
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

const bytes=[...unzipSync(readFileSync(f+'control.docx'))['word/media/vector.svg']];
const browser=await chromium.launch({channel:'chrome'});
const result={nativeSha256:ref.nativeSha256,referenceSha256:createHash('sha256').update(readFileSync(process.argv[2]||'.private-svg-translucent-native.json')).digest('hex'),browser:browser.version(),paths:{},routeHits:{}};
try{
 for(const mode of ['baseline','composite']){
  const context=await browser.newContext();
  try{
   if(mode==='composite')await context.route('**/src/engine/svg-*.js*',r=>{const name=new URL(r.request().url()).pathname.split('/').pop();if(candidate[name])result.routeHits[name]=(result.routeHits[name]||0)+1;return candidate[name]?r.fulfill({contentType:'text/javascript',body:candidate[name]}):r.continue();});
   const page=await context.newPage();await page.goto('http://127.0.0.1:5173/playground.html');
   const samples=await page.evaluate(async({bytes,mode,samples})=>{
    const c=document.createElement('canvas');c.width=1200;c.height=900;const ctx=c.getContext('2d');
    const images=[],urls=[];
    try{
     if(mode==='baseline'){
      const{decodeSvg}=await import('/src/engine/svg-images.js');images.push(await decodeSvg(new Uint8Array(bytes)));
     }else{
      const{nativeSvgStrokes}=await import('/src/engine/svg-native-strokes.js');
      const root=new DOMParser().parseFromString(new TextDecoder().decode(new Uint8Array(bytes)),'image/svg+xml').documentElement;
      const p=nativeSvgStrokes(root,{width:120,height:90},true),resources=new Set(['defs','style','title','desc','clipPath']);
      for(let i=0;i<p.children.length;i++){
       if(resources.has(p.children[i].localName))continue;
       const layer=p.cloneNode(true);[...layer.children].forEach((n,j)=>{if(j!==i&&!resources.has(n.localName))n.remove();});
       const url=URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(layer)],{type:'image/svg+xml'}));urls.push(url);
       const image=new Image();images.push(image);image.src=url;await image.decode();
      }
     }
     if(images.length!==(mode==='baseline'?1:10))throw new Error('Unexpected paint image count');
     return samples.map(s=>{
      ctx.clearRect(0,0,1200,900);ctx.globalCompositeOperation='source-over';
      ctx.fillStyle=`rgba(${s.background.match(/../g).map(n=>parseInt(n,16)).join(',')},${s.alpha/255})`;ctx.fillRect(0,0,1200,900);
      const before=[...ctx.getImageData(600,50,1,1).data];
      for(const image of images){if(mode==='composite'){ctx.globalCompositeOperation='destination-out';ctx.drawImage(image,0,0,1200,900);ctx.globalCompositeOperation='lighter';}ctx.drawImage(image,0,0,1200,900);ctx.globalCompositeOperation='source-over';}
      return {...s,before,colors:Array.from({length:9},(_,row)=>[...ctx.getImageData(600,row*100+50,1,1).data])};
     });
    }finally{for(const image of images){if(image.close)image.close();else image.removeAttribute('src');}for(const url of urls)URL.revokeObjectURL(url);}
   },{bytes,mode,samples:ref.samples});
   const differences=samples.flatMap((s,i)=>s.colors.flatMap((v,row)=>v.some((n,j)=>n!==ref.samples[i].colors[row][j])?[{alpha:s.alpha,background:s.background,row,actual:v,native:ref.samples[i].colors[row]}]:[]));
   // Reconstruct premultiplied bytes. At byte alpha <=255, the rounded
   // unpremultiplied representation has less than half a byte of error here.
   const premult=v=>[...v.slice(0,3).map(n=>Math.round(n*v[3]/255)),v[3]];
   const premultDifferences=samples.flatMap((s,i)=>s.colors.flatMap((v,row)=>premult(v).some((n,j)=>n!==ref.samples[i].premultColors[row][j])?[{alpha:s.alpha,background:s.background,row,actual:premult(v),native:ref.samples[i].premultColors[row]}]:[]));
   result.paths[mode]={samples,differences,premultDifferences,matches:216-differences.length,premultMatches:216-premultDifferences.length,initialBackdropMatches:samples.filter((s,i)=>s.before.every((n,j)=>n===ref.samples[i].before[j])).length,initialPremultMatches:samples.filter((s,i)=>premult(s.before).every((n,j)=>n===ref.samples[i].beforePremult[j])).length};
  }finally{await context.close();}
 }
 for(const name of Object.keys(candidate))assert.equal(result.routeHits[name],1,name);
 for(const path of Object.values(result.paths))assert.equal(path.initialPremultMatches,24);
 assert.equal(result.paths.composite.premultMatches,216);
 writeFileSync(process.argv[3]||'.private-svg-translucent-browser.json',JSON.stringify(result,null,2));
 console.log(JSON.stringify(Object.fromEntries(Object.entries(result.paths).map(([mode,r])=>[mode,{matches:r.matches,premultMatches:r.premultMatches,initialBackdropMatches:r.initialBackdropMatches,initialPremultMatches:r.initialPremultMatches,premultDifferences:r.premultDifferences.slice(0,3)}]))));
}finally{await browser.close();}
