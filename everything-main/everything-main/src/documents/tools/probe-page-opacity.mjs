import {chromium} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
// Diagnostic only. Compare opaque/transparent page surfaces without changing
// offscreen canvases or production code. Readback forces submitted paint work
// to finish; this is a focused replay, not a user-interaction latency benchmark.
const [sourcePath,outputPath,url='http://127.0.0.1:5173/playground.html']=process.argv.slice(2);
if(!sourcePath||!outputPath)throw Error('Usage: node tools/probe-page-opacity.mjs SOURCE.docx OUTPUT.json [PLAYGROUND_URL]');
const source=readFileSync(sourcePath).toString('base64');
const browser=await chromium.launch({channel:'msedge',headless:true});const results=[];
try{
 for(let run=0;run<2;run++){
  const page=await browser.newPage({permissions:['local-fonts']});
  await page.goto(url,{waitUntil:'domcontentloaded'});
  results.push(await page.evaluate(async base64=>{
   const {openCanvasDocument}=await import('/src/engine/open-document.js');
   const {CanvasEditor}=await import('/src/engine/canvas-editor.js');
   const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));
   const getContext=HTMLCanvasElement.prototype.getContext;let opaque=false;
   HTMLCanvasElement.prototype.getContext=function(kind,options){return getContext.call(this,kind,opaque&&kind==='2d'&&this.classList.contains('canvas-page')?{...options,alpha:false}:options);};
   const editors=[];const results=[];
   try{
    for(const alpha of [true,false]){
     const {pkg,images}=await openCanvasDocument(bytes);const host=document.createElement('div');document.body.append(host);opaque=!alpha;
     editors.push(new CanvasEditor(host,{...pkg,images}));
    }
    const paint=e=>{e.paint();e.canvases[0].getContext('2d').getImageData(0,0,1,1);};
    for(const zoom of [1,2]){
     for(const e of editors)e.setZoom(zoom);
     for(let i=0;i<10;i++)for(const e of editors)paint(e);
     const pairs=[];
     for(let i=0;i<40;i++){
      const row=[];for(const n of i%2?[1,0]:[0,1]){const start=performance.now();for(let j=0;j<3;j++)paint(editors[n]);row[n]=(performance.now()-start)/3;}pairs.push(row);
     }
     const median=a=>[...a].sort((a,b)=>a-b)[Math.floor(a.length/2)];
     results.push({zoom,pairs,medians:[0,1].map(n=>median(pairs.map(r=>r[n]))),medianPairedDelta:median(pairs.map(r=>r[1]-r[0])),attributes:editors.map(e=>e.canvases[0].getContext('2d').getContextAttributes())});
    }
   }finally{HTMLCanvasElement.prototype.getContext=getContext;for(const e of editors)e.destroy();}
   return results;
  },source));await page.close();
 }
}finally{await browser.close();}
writeFileSync(outputPath,JSON.stringify(results,null,2));console.log(JSON.stringify(results.map(run=>run.map(({zoom,medians,medianPairedDelta})=>({zoom,medians,medianPairedDelta}))),null,2));
