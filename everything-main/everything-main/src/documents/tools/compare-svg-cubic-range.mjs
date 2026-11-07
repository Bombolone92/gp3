// Reference substitution is confined to an isolated diagnostic context.
// This measures API/native reference correspondence; it is not a production algorithm.
import {chromium} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
const output=process.argv[2];
if(!output)throw Error('Usage: node tools/compare-svg-cubic-range.mjs OUTPUT_JSON');
const folder='tests/fixtures/svg-cubic-range/',hash=b=>createHash('sha256').update(b).digest('hex');
const bytes=readFileSync(folder+'control.docx'),cases=JSON.parse(readFileSync(folder+'cases.json'));
const ref=JSON.parse(readFileSync(folder+'metafile-reference.json'));
const apiBytes=readFileSync(folder+'api-cases.json'),apiCases=JSON.parse(apiBytes);
const api=JSON.parse(readFileSync(folder+'native-api.json','utf8').replace(/^\uFEFF/,''));
if(hash(bytes)!==ref.sourceSha256||hash(readFileSync(folder+'cases.json'))!==ref.casesSha256||hash(apiBytes)!==api.inputSha256||!api.quantizeInput||api.tolerance!==.25||api.cases.length!==apiCases.length)throw Error('Reference binding failed');
const refs=ref.images.map(im=>{const b=readFileSync(folder+im.path);if(hash(b)!==im.sha256)throw Error('Wrong reference layer');return 'data:image/png;base64,'+b.toString('base64');});
const map=Object.fromEntries(apiCases.map((c,i)=>{
 if(c.name!==api.cases[i].name)throw Error('Wrong API ordering');
 const flat=api.cases[i].points;
 return [JSON.stringify(c.points),Array.from({length:flat.length/2},(_,j)=>flat.slice(j*2,j*2+2))];
}));
const production=readFileSync('src/engine/svg-group-cubic.js','utf8');
const start=production.indexOf('export function flattenSvgGroupCubic('),end=production.indexOf('export function svgGroupCubicContours(');
if(start<0||end<=start)throw Error('Module boundary changed');
const substitute=`const references=${JSON.stringify(map)};export function flattenSvgGroupCubic(input){const result=references[JSON.stringify(input)];if(!result)throw Error('Unbound reference curve');return result.map(p=>[...p]);}\n`;
const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||'chrome',headless:true});
const report={scope:'Own reference layer RGBA versus production and isolated native-API vertex substitution. Each independent group is evaluated separately within the unchanged aggregate raster budget. No runtime rule is selected.',productionSha256:hash(production),sourceSha256:hash(bytes),apiSha256:hash(readFileSync(folder+'native-api.json')),rows:[]};
try{
 for(const variant of ['current','native-api-reference']){
  const context=await browser.newContext();
  if(variant!=='current')await context.route('**/src/engine/svg-group-cubic.js*',r=>r.fulfill({contentType:'text/javascript',body:production.slice(0,start)+substitute+production.slice(end)}));
  const page=await context.newPage();await page.goto(process.env.DOCX_AUDIT_URL||'http://127.0.0.1:5173/playground.html',{timeout:180000});
  const result=await page.evaluate(async({svg,refs})=>{
   const {nativeSvgStrokes}=await import('/src/engine/svg-native-strokes.js');
   const source=new DOMParser().parseFromString(svg,'image/svg+xml').documentElement;
   const sourceBefore=new XMLSerializer().serializeToString(source),children=document.body.children.length;
   const pixels=async url=>{const im=new Image();im.src=url;await im.decode();const c=document.createElement('canvas');c.width=im.width;c.height=im.height;const ctx=c.getContext('2d');ctx.drawImage(im,0,0);return {size:[c.width,c.height],rgba:ctx.getImageData(0,0,c.width,c.height).data};};
   const rows=[];
   for(let i=0;i<refs.length;i++){
    const root=source.cloneNode(true);
    for(const [index,g]of [...root.children].entries())if(index!==i)g.remove();
    const original=new XMLSerializer().serializeToString(root);
    const output=nativeSvgStrokes(root,{width:+root.getAttribute('width'),height:+root.getAttribute('height')},true);
    if(!output||output.querySelectorAll('image').length!==1)throw Error('No unique diagnostic layer');
    if(original!==new XMLSerializer().serializeToString(root))throw Error('Layer source changed');
    const im=output.querySelector('image');
    const a=await pixels(im.getAttribute('href')),b=await pixels(refs[i]);let alpha=0,rgb=0;
    if(a.rgba.length!==b.rgba.length)throw Error('Layer extent changed');
    for(let k=0;k<a.rgba.length;k+=4){alpha+=a.rgba[k+3]!==b.rgba[k+3];if(a.rgba[k+3]||b.rgba[k+3])rgb+=a.rgba[k]!==b.rgba[k]||a.rgba[k+1]!==b.rgba[k+1]||a.rgba[k+2]!==b.rgba[k+2];}
    rows.push({index:i,size:a.size,origin:[+im.getAttribute('x'),+im.getAttribute('y')],changedAlpha:alpha,changedVisibleRgb:rgb});
   }
   return {rows,sourceUnchanged:sourceBefore===new XMLSerializer().serializeToString(source),temporaryHostsRemoved:children===document.body.children.length};
  },{svg:new TextDecoder().decode(unzipSync(bytes)['word/media/vector.svg']),refs});
  if(result.rows.length!==cases.length||!result.sourceUnchanged||!result.temporaryHostsRemoved)throw Error(`Source/host correspondence failed: ${JSON.stringify({variant,layers:result.rows.length,expected:cases.length,sourceUnchanged:result.sourceUnchanged,temporaryHostsRemoved:result.temporaryHostsRemoved})}`);
  for(const row of result.rows){if(JSON.stringify(row.size)!==JSON.stringify(ref.images[row.index].size)||JSON.stringify(row.origin)!==JSON.stringify(ref.images[row.index].transform.slice(4)))throw Error('Native origin/size mismatch');row.case=cases[row.index].name;}
  report.rows.push({variant,...result});await context.close();
 }
 if(hash(readFileSync('src/engine/svg-group-cubic.js','utf8'))!==report.productionSha256)throw Error('Runtime source changed');
 report.productionUnchanged=true;writeFileSync(output,JSON.stringify(report,null,2)+'\n');
 for(const r of report.rows)console.log(r.variant,r.rows.filter(r=>!r.changedAlpha&&!r.changedVisibleRgb).length+'/'+r.rows.length+' exact',r.rows.reduce((n,r)=>n+r.changedAlpha,0)+' alpha differences');
}finally{await browser.close();}
