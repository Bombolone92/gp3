// Isolated browser hypotheses against original native reference controls. No file
// or production renderer mutation; the optional route exists only in this page.
import {chromium} from '@playwright/test';
import {unzipSync} from 'fflate';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

const output=process.argv[2];if(!output)throw Error('Supply an output JSON path.');
const folder=(process.argv[3]||'tests/fixtures/svg-cubic-terminal-rounding').replace(/[\\/]+$/,'')+'/',hash=b=>createHash('sha256').update(b).digest('hex');
const ref=JSON.parse(readFileSync(folder+'metafile-reference.json'));
for(const [file,key] of [['control.docx','sourceSha256'],['cases.json','casesSha256'],['capture.emf','captureSha256'],['capture.json','captureMetadataSha256'],['native.emf','nativeSha256']])if(hash(readFileSync(folder+file))!==ref[key])throw Error('Reference hash mismatch: '+file);
for(const im of ref.images)if(hash(readFileSync(folder+im.path))!==im.sha256)throw Error('Image hash mismatch: '+im.path);
const source=readFileSync('src/engine/svg-group-cubic.js','utf8'),hook='Math.floor(v / 16384 + .5) / 16';
if(!source.includes(hook))throw Error('Rounding hypothesis needs review for the current renderer.');
const browser=await chromium.launch({channel:'chrome',headless:true}),variants=[];
try {
 for(const variant of process.argv.includes('--current-only')?['current']:['current','even']){
  const context=await browser.newContext(),page=await context.newPage();
  try{
   if(variant==='even')await page.route('**/src/engine/svg-group-cubic.js*',r=>r.fulfill({contentType:'text/javascript',body:source.replace(hook,'(()=>{const q=v/16384,f=Math.floor(q);return (q-f===.5?f+(f%2!==0):Math.floor(q+.5))/16;})()')}));
   await page.goto('http://127.0.0.1:5173/playground.html');
   const rows=await page.evaluate(async({svg,refs})=>{
    const {nativeSvgStrokes}=await import('/src/engine/svg-native-strokes.js');
    const root=new DOMParser().parseFromString(svg,'image/svg+xml').documentElement;
    const before=new XMLSerializer().serializeToString(root),children=document.body.children.length;
    const width=+root.getAttribute('width'),height=+root.getAttribute('height');
    if(!(width>0&&height>0))throw Error('Expected explicit positive intrinsic dimensions');
    const prepared=nativeSvgStrokes(root,{width,height},true);
    const decode=async url=>{const image=new Image();image.src=url;await image.decode();const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);return ctx.getImageData(0,0,canvas.width,canvas.height).data;};
    const rows=[];
    for(const [i,image] of [...prepared.querySelectorAll('image')].entries()){
     const a=await decode(image.getAttribute('href')),b=await decode(refs[i]);if(a.length!==b.length)throw Error('Layer size mismatch');let alpha=0,rgb=0;
     for(let at=0;at<a.length;at+=4){alpha+=a[at+3]!==b[at+3];rgb+=(a[at+3]||b[at+3])&&(a[at]!==b[at]||a[at+1]!==b[at+1]||a[at+2]!==b[at+2]);}
     rows.push({index:i,origin:[+image.getAttribute('x'),+image.getAttribute('y')],size:[+image.getAttribute('width'),+image.getAttribute('height')],changedAlpha:alpha,changedRgb:rgb});
    }
    if(before!==new XMLSerializer().serializeToString(root)||children!==document.body.children.length)throw Error('Source/host preservation failed');
    return rows;
   },{svg:new TextDecoder().decode(unzipSync(readFileSync(folder+'control.docx'))['word/media/vector.svg']),refs:ref.images.map(i=>'data:image/png;base64,'+readFileSync(folder+i.path).toString('base64'))});
   if(rows.length!==ref.images.length)throw Error('Layer count mismatch');
   for(const row of rows)if(JSON.stringify(row.size)!==JSON.stringify(ref.images[row.index].size)||JSON.stringify(row.origin)!==JSON.stringify(ref.images[row.index].transform.slice(4)))throw Error('Layer bounds differ');
   variants.push({variant,exactLayers:rows.filter(r=>!r.changedAlpha&&!r.changedRgb).length,rows});
  }finally{await context.close();}
 }
 writeFileSync(output,JSON.stringify({scope:'Independent native reference raster controls. Isolated hypotheses; no renderer correction.',rendererSha256:hash(source.replaceAll('\r\n','\n')),reference:ref,variants},null,2)+'\n');
 console.log(JSON.stringify(variants.map(v=>({variant:v.variant,exactLayers:v.exactLayers,differentAlphaPixels:v.rows.reduce((n,r)=>n+r.changedAlpha,0)}))));
}finally{await browser.close();}
