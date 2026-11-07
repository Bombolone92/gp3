// Reproduce a rejected paint-only hypothesis; never modifies the live engine.
import {coupledSources,coupledRoute} from './border-relative-experiment.mjs';
import {chromium} from '@playwright/test';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const root=process.argv[2];if(!root)throw Error('output directory required');
const experiment='coupled-relative';
const original=readFileSync('src/engine/border-device-layout.js','utf8');
const candidate=coupledSources(original,readFileSync('src/engine/canvas-editor.js','utf8')).border;
const evidence=JSON.parse(readFileSync('tests/fixtures/measurements/border-leading-candidate.json'));
const sha=value=>createHash('sha256').update(value).digest('hex');
if(sha(original.replace(/\r\n/g,'\n'))!==evidence.baselineCanonicalSha256)throw Error('The archived experiment requires its exact baseline and rejected candidate; re-audit after source changes.');
const summary={experiment,edges:0,improved:0,regressions:[]};
mkdirSync(root,{recursive:true});writeFileSync(join(root,'candidate.js'),candidate);
const sources=['control','holdout','reordered','heights-thin','heights-wide','filled','borderless'].map(name=>({name,folder:'border-phase'}));sources.push({name:'control',folder:'border-axis-phase'});
const browser=await chromium.launch({channel:'chrome',headless:true});
try{for(const mode of ['baseline','candidate']){
 const context=await browser.newContext({deviceScaleFactor:1});
 if(mode==='candidate')await coupledRoute(context);

 const page=await context.newPage();await page.goto('http://127.0.0.1:5173/playground.html',{timeout:120000});
 for(const {name,folder} of sources){
  const refs=folder==='border-axis-phase'?[100,200].map(z=>JSON.parse(readFileSync(`tests/fixtures/${folder}/screen-reference${z===100?'':'-200'}.json`))):
   (['filled','borderless'].includes(name)?JSON.parse(readFileSync('tests/fixtures/border-phase/native-fill-reference.json')).controls.find(c=>c.source===name+'.docx').observations:name.startsWith('heights-')?JSON.parse(readFileSync('tests/fixtures/border-phase/native-height-reference.json')).controls.find(c=>c.source===name+'.docx').observations:
    JSON.parse(readFileSync(`tests/fixtures/border-phase/${name==='control'?'':'native-'+name+'-'}reference.json`)).observations).map(o=>({zoom:o.zoom,observations:[{page:1,comparisons:o.comparisons.map((c,i)=>({...c,region:o.regions[i]}))}]}));
  if(folder==='border-phase'&&name==='control')refs.push(...JSON.parse(readFileSync('tests/fixtures/border-phase/native-intermediate-reference.json')).observations.map(o=>({zoom:o.zoom,observations:[{page:1,comparisons:o.comparisons.map((c,i)=>({...c,region:o.regions[i]}))}]})));
  const source=`tests/fixtures/${folder}/${name}.docx`,bytes=readFileSync(source),entry=evidence.entries.find(e=>e.source===source);
  if(sha(bytes)!==entry.sourceSha256)throw Error('Source changed: '+source);
  const result=await page.evaluate(async({bytes,refs,fill})=>{
   const {openCanvasDocument}=await import('/src/engine/open-document.js'),{CanvasEditor}=await import('/src/engine/canvas-editor.js');
   const {pkg,images}=await openCanvasDocument(new Uint8Array(bytes)),host=document.createElement('div');document.body.append(host);const errors=[];
   const editor=new CanvasEditor(host,{...pkg,images,onError:e=>errors.push(e.message)}),out=[];
   try{for(const ref of refs){editor.setZoom(ref.zoom/100);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));editor.paint();
    const rows=[];for(const p of ref.observations){const canvas=editor.canvases[p.page-1],ctx=canvas.getContext('2d');
     for(const c of p.comparisons){const [x,y,w,h]=c.region,data=ctx.getImageData(x,y,w,h).data;let bounds=[Infinity,Infinity,-Infinity,-Infinity];
      for(let dy=0;dy<h;dy++)for(let dx=0;dx<w;dx++){const i=(dy*w+dx)*4;const [red,green,blue]=data.slice(i,i+3);if(fill?!((.299*red+.587*green+.114*blue)<166&&red>128&&red>green+32&&red>blue+32):Math.max(red,green,blue)>=128)continue;bounds=[Math.min(bounds[0],x+dx),Math.min(bounds[1],y+dy),Math.max(bounds[2],x+dx+1),Math.max(bounds[3],y+dy+1)];}
      rows.push({page:p.page,id:c.id,native:c.native,actual:bounds});}
    }out.push({zoom:ref.zoom,rows,pages:editor.canvases.length,readOnly:!!pkg.readOnly,errors:[...errors],pngs:editor.canvases.map(c=>c.toDataURL().split(',')[1])});
   }}finally{editor.destroy();host.remove();}return out;
  },{bytes:[...bytes],refs,fill:['filled','borderless'].includes(name)});
  for(const r of result){
   if(r.readOnly||r.errors.length)throw Error('Document setup failed: '+source);
   const expected=entry.observations.find(o=>o.zoom===r.zoom);
   if(mode==='baseline'&&JSON.stringify(r.rows.map(c=>c.actual))!==JSON.stringify(expected.rows.map(c=>c[mode])))throw Error('Recorded pixels changed: '+source+' '+mode+' '+r.zoom);
   if(JSON.stringify(r.rows.map(c=>c.native))!==JSON.stringify(expected.rows.map(c=>c.native)))throw Error('Native reference changed: '+source);
   if(mode==='candidate')for(const [j,c]of r.rows.entries())for(let edge=0;edge<4;edge++){
    const baseline=expected.rows[j].baseline[edge],native=c.native[edge],actual=c.actual[edge];summary.edges++;
    summary.improved+=Math.abs(actual-native)<Math.abs(baseline-native);
    if(Math.abs(actual-native)>Math.abs(baseline-native))summary.regressions.push({source,zoom:r.zoom,page:c.page,id:c.id,edge,native,baseline,candidate:actual});
   }
  }
  for(const r of result){for(const [i,png]of r.pngs.entries())writeFileSync(join(root,`${mode}-${folder}-${name}-${r.zoom}-p${i+1}.png`),Buffer.from(png,'base64'));delete r.pngs;}
  writeFileSync(join(root,`${mode}-${folder}-${name}.json`),JSON.stringify(result,null,2)+'\n');console.log(mode,folder,name,JSON.stringify(result.map(r=>({zoom:r.zoom,matches:[0,1,2,3].map(i=>r.rows.filter(c=>c.native[i]===c.actual[i]).length),frames:r.rows.filter(c=>c.native.every((v,i)=>v===c.actual[i])).length,total:r.rows.length,errors:r.errors}))));
 }await context.close();
}
 writeFileSync(join(root,'summary.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary));
}finally{await browser.close();}
