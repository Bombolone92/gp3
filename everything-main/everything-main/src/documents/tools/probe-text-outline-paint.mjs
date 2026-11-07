// Diagnostic replay for the original small-text fixture, not a production painter.
// Font binaries are read locally; no glyph data is written to the repository.
import {chromium} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
const [callsPath,fontDirectory,outputPrefix,url='http://127.0.0.1:5173/playground.html']=process.argv.slice(2);
if(!callsPath||!fontDirectory||!outputPrefix)throw Error('Usage: node tools/probe-text-outline-paint.mjs CALLS.json FONT_DIRECTORY OUTPUT_PREFIX [PLAYGROUND_URL]');
const browser=await chromium.launch({headless:true,channel:'msedge'});
try {
 const page=await browser.newPage({deviceScaleFactor:3});
 await page.goto(url);
 const result=await page.evaluate(async ({calls,sources})=>{
  const {parse}=await import('/src/vendor/opentype/opentype.mjs');
  const fonts=sources.map(s=>parse(Uint8Array.from(atob(s),c=>c.charCodeAt(0)).buffer));
  const measure=document.createElement('canvas').getContext('2d');
  const set=(ctx,c)=>{for(const k of ['font','fontKerning','textRendering','letterSpacing','wordSpacing','direction','textAlign','textBaseline','fillStyle'])ctx[k]=c[k];ctx.setTransform(...c.matrix);};
  const unique=[...new Map(calls.map(c=>[JSON.stringify(c),c])).values()];
  const prepared=[];const started=performance.now();
  for(const c of unique){
   const family=c.font.includes('Book Antiqua')?0:c.font.includes('Arial')?2:-1;
   if(family<0)continue;
   const font=fonts[family+(/bold|\b700\b/.test(c.font)?1:0)],size=Number(/([0-9.]+)px/.exec(c.font)[1]);
   if(c.direction==='rtl'||c.textBaseline!=='alphabetic'||!['left','start'].includes(c.textAlign)||c.rest.length)throw Error('Unsupported diagnostic state');
   set(measure,c);let prefix='';const path=new Path2D();
   for(const ch of c.text){
    const glyph=font.charToGlyph(ch);if(!glyph.index)throw Error('Missing glyph');
    const x=prefix?measure.measureText(prefix+ch).width-measure.measureText(ch).width:0;
    path.addPath(new Path2D(glyph.getPath(x,0,size).toPathData(6)));prefix+=ch;
   }
   prepared.push({c,path});
  }
  const preparationMilliseconds=performance.now()-started;
  const canvas=document.createElement('canvas');canvas.width=2448;canvas.height=3168;const ctx=canvas.getContext('2d');
  const paint=mode=>{
   ctx.resetTransform();ctx.fillStyle='#55826b';ctx.fillRect(0,0,canvas.width,canvas.height);
   for(const {c,path} of prepared){set(ctx,c);if(mode==='canvas')ctx.fillText(c.text,c.x,c.y);else{ctx.save();ctx.translate(c.x,c.y);ctx.fill(path);ctx.restore();}}
   ctx.getImageData(0,0,1,1);
  };
  for(let i=0;i<20;i++){paint('canvas');paint('outline');}
  const samples={canvas:[],outline:[]};
  for(let block=0;block<4;block++)for(const mode of block%2?['outline','canvas']:['canvas','outline'])for(let i=0;i<15;i++){
   const start=performance.now();for(let j=0;j<5;j++)paint(mode);samples[mode].push((performance.now()-start)/5);
  }
  const median=a=>[...a].sort((a,b)=>a-b)[Math.floor(a.length/2)];
  paint('outline');const outline=canvas.toDataURL();paint('canvas');const baseline=canvas.toDataURL();
  return {calls:calls.length,uniqueCalls:unique.length,preparedCalls:prepared.length,preparationMilliseconds,samples,medianMilliseconds:{canvas:median(samples.canvas),outline:median(samples.outline)},outline,baseline};
 },{calls:JSON.parse(readFileSync(callsPath,'utf8')),sources:['BKANT.TTF','ANTQUAB.TTF','arial.ttf','arialbd.ttf'].map(n=>readFileSync(join(fontDirectory,n)).toString('base64'))});
 for(const name of ['outline','baseline']){writeFileSync(outputPrefix+'-'+name+'.png',Buffer.from(result[name].split(',')[1],'base64'));delete result[name];}
 writeFileSync(outputPrefix+'.json',JSON.stringify(result,null,2));
 console.log(JSON.stringify({...result,samples:undefined}));
} finally {await browser.close();}

