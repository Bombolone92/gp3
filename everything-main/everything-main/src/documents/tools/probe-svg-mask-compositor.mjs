// Exact native alpha diagnostic; never activates a production rendering path.
import {chromium} from '@playwright/test';
import {unzipSync} from 'fflate';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const hash=data=>createHash('sha256').update(data).digest('hex');
const fragment=readFileSync(new URL('./svg-mask-compositor-probe.js',import.meta.url),'utf8');
const browser=await chromium.launch({channel:'msedge',headless:true});
try {
 const page=await browser.newPage();
 await page.route('**/src/engine/svg-native-groups.js*',async route=>{
  const response=await route.fetch();await route.fulfill({response,body:await response.text()+'\n'+fragment});
 });
 await page.goto(process.argv[2]||'http://127.0.0.1:5173/playground.html');
 const results=[];
 for(const name of ['svg-mask-quantization','svg-mask-quantization-boundary','svg-mask-composition','svg-mask-nested']) {
  const folder=`tests/fixtures/${name}/`,source=readFileSync(`public/fixtures/${name}.docx`);
  const reference=JSON.parse(readFileSync(folder+'metafile-reference.json'));
  if(hash(source)!==reference.sourceSha256||hash(readFileSync(folder+'native.emf'))!==reference.nativeSha256)throw Error('Source/native integrity: '+name);
  const refs=reference.images.map(ref=>{
   const png=readFileSync(folder+ref.path);if(hash(png)!==ref.sha256)throw Error('PNG integrity: '+ref.path);
   return {...ref,url:'data:image/png;base64,'+png.toString('base64')};
  });
  const xml=new TextDecoder().decode(unzipSync(source)['word/media/vector.svg']);
  const rows=await page.evaluate(async({xml,refs})=>{
   const {probeNativeRender}=await import('/src/engine/svg-native-groups.js');
   const svg=document.importNode(new DOMParser().parseFromString(xml,'image/svg+xml').documentElement,true);
   const host=document.createElement('div');host.style.cssText='position:absolute;left:-99999px;top:0';host.append(svg);document.body.append(host);
   try {
    const masks=[...svg.querySelectorAll('mask')];if(masks.length!==refs.length)throw Error('Mask count');
    const rows=[];
    for(const [i,mask] of masks.entries()) {
     const layer=probeNativeRender(mask.firstElementChild);if(!layer)throw Error('Unsupported probe geometry');
     const ref=refs[i],image=new Image();image.src=ref.url;await image.decode();
     const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
     const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);const native=ctx.getImageData(0,0,canvas.width,canvas.height).data;
     if(ref.transform.slice(0,4).join(',')!=='1,0,0,1')throw Error('Unexpected native transform');
     const dx=ref.transform[4]-layer.x,dy=ref.transform[5]-layer.y;
     if(!Number.isInteger(dx)||!Number.isInteger(dy))throw Error('Unaligned native frame');
     let differences=0,maximumError=0;
     for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++) {
      const xx=x+dx,yy=y+dy,at=(yy*layer.width+xx)*4;
      const p=xx>=0&&xx<layer.width&&yy>=0&&yy<layer.height?layer.pixels.slice(at,at+4):[0,0,0,0];
      const alpha=Math.round(Math.round(p[0]*.2126+p[1]*.7152+p[2]*.0722)*p[3]/255);
      const error=Math.abs(alpha-native[(y*canvas.width+x)*4+3]);if(error)differences++;maximumError=Math.max(maximumError,error);
     }
     rows.push({case:i,pixels:canvas.width*canvas.height,differences,maximumError});
    }
    return rows;
   }finally{host.remove();}
  },{xml,refs});
  results.push({fixture:name,sourceSha256:reference.sourceSha256,nativeSha256:reference.nativeSha256,rows});
 }
 console.log(JSON.stringify({productionActivated:false,probeLfSha256:hash(fragment.replace(/\r\n/g,'\n')),results},null,2));
 process.exitCode=Number(results.some(r=>r.rows.some(row=>row.differences)));
}finally{await browser.close();}
