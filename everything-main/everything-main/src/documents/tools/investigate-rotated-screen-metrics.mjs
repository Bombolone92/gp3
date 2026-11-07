// Isolated hypotheses: never mutate source, layout, or production modules.
import {chromium} from '@playwright/test';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
const [output,baseURL='http://127.0.0.1:5173']=process.argv.slice(2);
if(!output)throw Error('Usage: node tools/investigate-rotated-screen-metrics.mjs OUTPUT [BASE_URL]');
mkdirSync(output,{recursive:true});
const hash=b=>createHash('sha256').update(b).digest('hex');
const path='src/engine/canvas-cell-text.js',module=readFileSync(path,'utf8');
const needle='  context.transform(...physical.cellText.matrix);';
const returned='  return { line: physical.cellText.line, geometry: physical.cellText.geometry };';
if(module.split(needle).length!==2||module.split(returned).length!==2)throw Error('Changed hypothesis site');
const origin=module.replace(needle,needle+'\n  const m=context.getTransform();context.setTransform(m.a,m.b,m.c,m.d,Math.round(m.e),Math.round(m.f));');
const variants={current:module,'snap-origin':origin};
for(const mode of ['floor','round','ceil'])variants[`snap-origin-${mode}-twip`]=origin.replace(returned,
 `  return { line: {...physical.cellText.line,baseline:Math.${mode}(physical.cellText.line.baseline*15)/15}, geometry: physical.cellText.geometry };`);
const sources=['live-screen','screen-metrics'].map(name=>{const path=`tests/fixtures/cell-text-direction/${name}/control.docx`;return {name,path,bytes:readFileSync(path)};});
const manifest={engineRevision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),moduleSha256:hash(module),
 scope:'Paint-only origin and baseline hypotheses on authored controls, not a proposed production fix. Relative threshold bounds do not prove glyph-shape or absolute-page equivalence.',
 sources:sources.map(s=>({name:s.name,path:s.path,sha256:hash(s.bytes)})),rows:[]};
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 for(const [variant,body] of Object.entries(variants)){
  const context=await browser.newContext();
  try{
   if(variant!=='current')await context.route('**/src/engine/canvas-cell-text.js*',r=>r.fulfill({status:200,contentType:'text/javascript',body}));
   const page=await context.newPage();await page.goto(new URL('/playground.html',baseURL).href,{timeout:180000});
   for(const source of sources){
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
      if(editor.layout.pageCount!==(name==='live-screen'?2:6)||pkg.readOnly||bounds.some(b=>b.length!==6))throw Error('Changed control loading or bounded glyph isolation');
      return {zoomPercent:scale*100,pages:editor.layout.pageCount,bounds,pictures:canvases.map(c=>c.toDataURL().split(',')[1])};
     });}finally{editor.destroy();host.remove();}
    },{bytes:[...source.bytes],name:source.name});
    for(const row of observations){const pictures=row.pictures.map((data,index)=>{const name=`${source.name}-${variant}-page${index+1}-${row.zoomPercent}.png`,png=Buffer.from(data,'base64');writeFileSync(resolve(output,name),png);return {name,sha256:hash(png)};});manifest.rows.push({...row,pictures,source:source.name,variant});}
   }
  }finally{await context.close();}
 }
 if(hash(readFileSync(path,'utf8'))!==manifest.moduleSha256||sources.some(s=>hash(readFileSync(s.path))!==hash(s.bytes)))throw Error('Source or production module changed');
 writeFileSync(resolve(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');console.log(JSON.stringify({rows:manifest.rows.length,sources:manifest.sources}));
}finally{await browser.close();}
