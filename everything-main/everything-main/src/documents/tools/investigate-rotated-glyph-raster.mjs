// Isolated hypotheses: never mutate source, layout, or production modules.
import {chromium} from '@playwright/test';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
const [output,baseURL='http://127.0.0.1:5173']=process.argv.slice(2);
if(!output)throw Error('Usage: node tools/investigate-rotated-glyph-raster.mjs OUTPUT [BASE_URL]');
mkdirSync(output,{recursive:true});
const hash=b=>createHash('sha256').update(b).digest('hex');
const path='src/engine/canvas-paint-text.js',module=readFileSync(path,'utf8');
const needle='  if (hasFill) ctx.fillText(text, x, y);';
if(module.split(needle).length!==2)throw Error('Changed ordinary fill site');
const rasterFunction=String.raw`
function isolatedRasterFill(ctx,text,x,y,snap) {
 const m=ctx.getTransform(),s=Math.hypot(m.a,m.b),t=Math.hypot(m.c,m.d);
 if(Math.abs(m.a)>1e-8||Math.abs(m.d)>1e-8||Math.abs(s-t)>1e-8||!s||typeof ctx.fillStyle!=='string') {ctx.fillText(text,x,y);return;}
 const metric=ctx.measureText(text),left=Math.floor(-metric.actualBoundingBoxLeft*s)-2,top=Math.floor(-metric.actualBoundingBoxAscent*s)-2;
 const right=Math.ceil(metric.actualBoundingBoxRight*s)+2,bottom=Math.ceil(metric.actualBoundingBoxDescent*s)+2;
 const bitmap=document.createElement('canvas');bitmap.width=right-left;bitmap.height=bottom-top;
 const local=bitmap.getContext('2d');
 for(const name of ['font','textAlign','textBaseline','direction','fontKerning','fontStretch','fontVariantCaps','letterSpacing','wordSpacing','textRendering'])if(name in ctx)local[name]=ctx[name];
 local.fillStyle=ctx.fillStyle;local.setTransform(s,0,0,s,-left,-top);local.fillText(text,0,0);
 const px=m.a*x+m.c*y+m.e,py=m.b*x+m.d*y+m.f;
 ctx.save();ctx.setTransform(m.a/s,m.b/s,m.c/s,m.d/s,snap?Math.round(px):px,snap?Math.round(py):py);
 ctx.imageSmoothingEnabled=!snap;ctx.drawImage(bitmap,left,top);ctx.restore();
}
`;
const variants={current:module};
for(const [name,snap] of [['raster-fractional',false],['raster-nearest',true]])variants[name]=module.replace(needle,`  if (hasFill) isolatedRasterFill(ctx,text,x,y,${snap});`)+rasterFunction;
const sources=['live-screen','screen-metrics'].map(name=>{const path=`tests/fixtures/cell-text-direction/${name}/control.docx`;return {name,path,bytes:readFileSync(path)};});
const manifest={engineRevision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),moduleSha256:hash(module),
 experiment:'quarter-turn-glyph-raster',
 scope:'Axis-aligned device-size glyph bitmap quarter-turned into the existing cell clip, with fractional or nearest-device baseline placement. Isolated plain-fill authored controls only; not production behavior, performance or general fidelity validation. Disconnected threshold-column groups are retained explicitly; they are not treated as six proven glyph bounds.',
 sources:sources.map(s=>({name:s.name,path:s.path,sha256:hash(s.bytes)})),rows:[]};
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 for(const [variant,body] of Object.entries(variants)){
  const context=await browser.newContext();
  try{
   if(variant!=='current')await context.route('**/src/engine/canvas-paint-text.js*',r=>r.fulfill({status:200,contentType:'text/javascript',body}));
   const page=await context.newPage();await page.goto(new URL('/playground.html',baseURL).href,{timeout:180000});
   for(const source of sources){
    console.log(JSON.stringify({variant,source:source.name}));
    const observations=await page.evaluate(async({bytes,name})=>{
     const {DocxPackage}=await import('/src/engine/docx.js');const {CanvasEditor}=await import('/src/engine/canvas-editor.js');const {loadCanvasFonts}=await import('/src/engine/canvas-text.js');
     const pkg=await DocxPackage.open(new Uint8Array(bytes));await loadCanvasFonts(pkg);const host=document.createElement('div');document.body.append(host);const editor=new CanvasEditor(host,pkg);
     try{return [1,2,5].map(scale=>{
      const canvases=editor.layout.pages.map(g=>{const c=document.createElement('canvas');c.width=Math.round(g.width*scale);c.height=Math.round(g.height*scale);return c;});editor.paint({canvases,interactive:false});
      const bounds=canvases.map(c=>{
       const left=15*scale,top=38*scale,width=130*scale,height=20*scale;
       const data=c.getContext('2d').getImageData(left,top,width,height).data,groups=[];
       for(let x=0;x<width;x++){
        let first=height,last=-1;for(let y=0;y<height;y++){const at=(y*width+x)*4;if(Math.max(data[at],data[at+1],data[at+2])<100){first=Math.min(first,y);last=y;}}
        if(last<0)continue;const prior=groups.at(-1);
        if(prior&&prior[2]===x+left-1){prior[2]=x+left;prior[1]=Math.min(prior[1],first+top);prior[3]=Math.max(prior[3],last+top);}else groups.push([x+left,first+top,x+left,last+top]);
       }return groups.reverse();
      });
      if(editor.layout.pageCount!==(name==='live-screen'?2:6)||pkg.readOnly)throw Error('Changed control loading');
      return {zoomPercent:scale*100,pages:editor.layout.pageCount,glyphIsolationValid:bounds.every(b=>b.length===6),bounds,pictures:canvases.map(c=>c.toDataURL().split(',')[1])};
     });}finally{editor.destroy();host.remove();}
    },{bytes:[...source.bytes],name:source.name});
    for(const row of observations){const pictures=row.pictures.map((data,index)=>{const name=`${source.name}-${variant}-page${index+1}-${row.zoomPercent}.png`,png=Buffer.from(data,'base64');writeFileSync(resolve(output,name),png);return {name,sha256:hash(png)};});manifest.rows.push({...row,pictures,source:source.name,variant});}
   }
  }finally{await context.close();}
 }
 if(hash(readFileSync(path,'utf8'))!==manifest.moduleSha256||sources.some(s=>hash(readFileSync(s.path))!==hash(s.bytes)))throw Error('Source or production module changed');
 writeFileSync(resolve(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');console.log(JSON.stringify({rows:manifest.rows.length,sources:manifest.sources}));
}finally{await browser.close();}
