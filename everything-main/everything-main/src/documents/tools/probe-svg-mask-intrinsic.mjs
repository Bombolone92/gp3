// Compare native embedded raster coordinates before the existing viewport frame transform.
// The second pass uses the current worktree; this does not assert conformance.
import {chromium} from '@playwright/test';
import {unzipSync} from 'fflate';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url)),browser=await chromium.launch({channel:'msedge',headless:true}),out=[];
try{for(const baseline of [true,false]){
 const page=await browser.newPage();
 if(baseline)await page.route(/\/src\/engine\/svg-word-(?:groups|strokes)\.js(?:\?.*)?$/,route=>{
  const file=new URL(route.request().url()).pathname.split('/').at(-1);
  return route.fulfill({contentType:'text/javascript',body:execFileSync('git',['show',`ba8b282c:src/engine/${file}`],{cwd:root,encoding:'utf8'})});
 });
 await page.goto(new URL('/playground.html',process.argv[2]||'http://127.0.0.1:5173').href);
 for(const name of ['svg-mask-opacity','svg-mask-opacity-expanded','svg-mask-opaque']){
  const source=unzipSync(readFileSync(`${root}/public/fixtures/${name}.docx`))['word/media/vector.svg'];
  const refs=JSON.parse(readFileSync(`${root}/tests/fixtures/${name}/metafile-reference.json`)).images.map(ref=>({...ref,url:'data:image/png;base64,'+readFileSync(`${root}/tests/fixtures/${name}/${ref.path}`).toString('base64')}));
  const rows=await page.evaluate(async({source,refs})=>{
   const {nativeSvgStrokes}=await import('/src/engine/svg-native-strokes.js');
   const root=new DOMParser().parseFromString(new TextDecoder().decode(new Uint8Array(source)),'image/svg+xml').documentElement; const output=nativeSvgStrokes(root,{width:120,height:80},true); output.style.transform='none'; const image=new Image(); image.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(new XMLSerializer().serializeToString(output)); await image.decode(); const canvas=document.createElement('canvas');canvas.width=120;canvas.height=80;
   const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);const rows=[];
   for(const [i,ref] of refs.entries()){
    const im=new Image();im.src=ref.url;await im.decode();const c=document.createElement('canvas');c.width=im.width;c.height=im.height;const n=c.getContext('2d');n.drawImage(im,0,0);
    const native=n.getImageData(0,0,c.width,c.height).data,actual=ctx.getImageData(ref.transform[4],ref.transform[5],c.width,c.height).data;
    let differences=0,total=0,max=0;for(let at=3;at<native.length;at+=4){const delta=Math.abs(actual[at]-native[at]);if(delta)differences++;total+=delta;max=Math.max(max,delta);}
    rows.push({case:i,differences,total,max});
   }return rows;
  },{source:[...source],refs});out.push({baseline,name,rows});
 }
 await page.close();
}console.log(JSON.stringify(out,null,2));}finally{await browser.close();}
