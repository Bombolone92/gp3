// Isolated diagnostic only: route one experimental mathematical module into a
// separate browser context. Engine files, source DOCX/SVG and references stay intact.
import {chromium} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
const output=process.argv[2];if(!output)throw Error('Usage: node tools/compare-svg-midpoint-state.mjs OUTPUT_JSON');
const hash=b=>createHash('sha256').update(b).digest('hex');
const families=['svg-cubic-terminal-rounding','svg-cubic-step-changes','svg-cubic-step-split','svg-cubic-phase'];
const production=readFileSync('src/engine/svg-group-cubic.js','utf8'),candidate=readFileSync('tools/candidates/svg-cubic-midpoint-state.mjs','utf8');
const start=production.indexOf('export function flattenSvgGroupCubic('),end=production.indexOf('export function svgGroupCubicContours(');
if(start<0||end<=start)throw Error('Module boundary changed');
const experimental=production.slice(0,start)+candidate+'\n'+production.slice(end);
const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||'chrome',headless:true});
const report={scope:'Own reference layer RGBA comparisons in isolated current/candidate contexts; rejected candidate is never used by the app.',productionSha256:hash(production),candidateSha256:hash(candidate),rows:[]};
try{
 for(const variant of ['current','midpoint']){
  const context=await browser.newContext();
  if(variant==='midpoint')await context.route('**/src/engine/svg-group-cubic.js*',r=>r.fulfill({contentType:'text/javascript',body:experimental}));
  const page=await context.newPage();await page.goto(process.env.DOCX_AUDIT_URL||'http://127.0.0.1:5173/playground.html',{timeout:180000});
  for(const family of families){
   const folder=`tests/fixtures/${family}/`,bytes=readFileSync(folder+'control.docx'),ref=JSON.parse(readFileSync(folder+'metafile-reference.json'));
   if(hash(bytes)!==ref.sourceSha256)throw Error('Wrong fixture source');
   const refs=ref.images.map(im=>{const b=readFileSync(folder+im.path);if(hash(b)!==im.sha256)throw Error('Wrong reference layer');return 'data:image/png;base64,'+b.toString('base64');});
   const result=await page.evaluate(async({svg,refs})=>{
    const {nativeSvgStrokes}=await import('/src/engine/svg-native-strokes.js');
    const root=new DOMParser().parseFromString(svg,'image/svg+xml').documentElement,original=new XMLSerializer().serializeToString(root),children=document.body.children.length;
    const output=nativeSvgStrokes(root,{width:+root.getAttribute('width'),height:+root.getAttribute('height')},true);
    const pixels=async url=>{const im=new Image();im.src=url;await im.decode();const c=document.createElement('canvas');c.width=im.width;c.height=im.height;const ctx=c.getContext('2d');ctx.drawImage(im,0,0);return {size:[c.width,c.height],rgba:ctx.getImageData(0,0,c.width,c.height).data};};
    const rows=[];
    for(const[i,im]of [...output.querySelectorAll('image')].entries()){
     const a=await pixels(im.getAttribute('href')),b=await pixels(refs[i]);let alpha=0,rgb=0;
     if(a.rgba.length!==b.rgba.length)throw Error('Layer extent changed');
     for(let k=0;k<a.rgba.length;k+=4){alpha+=a.rgba[k+3]!==b.rgba[k+3];if(a.rgba[k+3]||b.rgba[k+3])rgb+=a.rgba[k]!==b.rgba[k]||a.rgba[k+1]!==b.rgba[k+1]||a.rgba[k+2]!==b.rgba[k+2];}
     rows.push({index:i,size:a.size,origin:[+im.getAttribute('x'),+im.getAttribute('y')],changedAlpha:alpha,changedVisibleRgb:rgb});
    }
    return {rows,sourceUnchanged:original===new XMLSerializer().serializeToString(root),temporaryHostsRemoved:children===document.body.children.length};
   },{svg:new TextDecoder().decode(unzipSync(bytes)['word/media/vector.svg']),refs});
   if(result.rows.length!==ref.images.length||!result.sourceUnchanged||!result.temporaryHostsRemoved)throw Error('Source/host correspondence failed');
   for(const row of result.rows){if(JSON.stringify(row.size)!==JSON.stringify(ref.images[row.index].size)||JSON.stringify(row.origin)!==JSON.stringify(ref.images[row.index].transform.slice(4)))throw Error('Native origin/size mismatch');}
   report.rows.push({variant,family,sourceSha256:ref.sourceSha256,nativeReferenceSha256:hash(readFileSync(folder+'metafile-reference.json')),...result});
  }
  await context.close();
 }
 if(hash(readFileSync('src/engine/svg-group-cubic.js','utf8'))!==report.productionSha256)throw Error('Runtime source changed');
 report.productionUnchanged=true;writeFileSync(output,JSON.stringify(report,null,2)+'\n');
 for(const r of report.rows)console.log(r.variant,r.family,r.rows.filter(r=>!r.changedAlpha&&!r.changedVisibleRgb).length+'/'+r.rows.length+' exact',r.rows.reduce((n,r)=>n+r.changedAlpha,0)+' alpha differences');
}finally{await browser.close();}
