// Historical diagnostic: record whole-crop regressions, never alter the live engine.
import{chromium}from'@playwright/test';
import{readFileSync,writeFileSync,mkdirSync}from'node:fs';
import{join}from'node:path';
import{createHash}from'node:crypto';
import{coupledRoute}from'./border-coupled-experiment.mjs';
const root=process.argv[2];if(!root)throw Error('Supply an output directory');mkdirSync(root,{recursive:true});
const widthThreshold=process.argv[3]==='width-threshold';
if(process.argv[3]&&!widthThreshold)throw Error('Unknown pixel experiment');
const modes=widthThreshold?['baseline','coupled']:['baseline','coupled','floor'];
const folder='tests/fixtures/border-shared-origin/',ref=JSON.parse(readFileSync(folder+'reference.json'));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),canonical=file=>sha(readFileSync(file,'utf8').replace(/\r\n/g,'\n'));
const results=[],browser=await chromium.launch({channel:'chrome',headless:true});
try{
 for(const mode of modes){
  const context=await browser.newContext({deviceScaleFactor:1});if(mode!=='baseline')await coupledRoute(context,{floorBottom:mode==='floor',widthThreshold});
  const page=await context.newPage();await page.goto('http://127.0.0.1:5173/playground.html',{timeout:120000});
  for(const source of ref.sources){
   const bytes=readFileSync(folder+source.owner+'.docx');if(sha(bytes)!==source.sourceSha256)throw Error('Source changed');
   const data=await page.evaluate(async({bytes,refs})=>{
    const{openCanvasDocument}=await import('/src/engine/open-document.js'),{CanvasEditor}=await import('/src/engine/canvas-editor.js');
    const{pkg,images}=await openCanvasDocument(new Uint8Array(bytes)),host=document.createElement('div');document.body.append(host);const errors=[];
    const editor=new CanvasEditor(host,{...pkg,images,onError:e=>errors.push(e.message)}),out=[];
    try{for(const o of refs){editor.setZoom(o.zoom/100);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));editor.paint();
     const c=document.createElement('canvas');[c.width,c.height]=o.cropSize;const ctx=c.getContext('2d');
     ctx.drawImage(editor.canvases[0],...o.cropOffset,...o.cropSize,0,0,...o.cropSize);
     out.push({zoom:o.zoom,png:c.toDataURL().split(',')[1]});
    }return{out,errors,pages:editor.canvases.length,readOnly:!!pkg.readOnly};}finally{editor.destroy();host.remove();}
   },{bytes:[...bytes],refs:source.observations});
   if(data.readOnly||data.pages!==1||data.errors.length)throw Error('Source setup failed');
   for(const o of data.out){const file=`${mode}-${source.owner}-${o.zoom}.png`,png=Buffer.from(o.png,'base64');writeFileSync(join(root,file),png);results.push({mode,owner:source.owner,zoom:o.zoom,file,sha256:sha(png)});}
  }await context.close();
 }
 const page=await browser.newPage();await page.goto('http://127.0.0.1:5173/playground.html');
 const observations=[];
 for(const source of ref.sources)for(const o of source.observations){
  const records=results.filter(r=>r.owner===source.owner&&r.zoom===o.zoom),images=[{mode:'native',png:readFileSync(folder+o.crop).toString('base64')},...records.map(r=>({mode:r.mode,png:readFileSync(join(root,r.file)).toString('base64')}))];
  const metrics=await page.evaluate(async({images,size,offset,modes})=>{
   const masks={};for(const image of images){const im=new Image();im.src='data:image/png;base64,'+image.png;await im.decode();if(im.width!==size[0]||im.height!==size[1])throw Error('Crop size changed');
    const c=document.createElement('canvas');c.width=im.width;c.height=im.height;const ctx=c.getContext('2d');ctx.drawImage(im,0,0);const d=ctx.getImageData(0,0,c.width,c.height).data;masks[image.mode]=Array.from({length:c.width*c.height},(_,i)=>Math.max(d[i*4],d[i*4+1],d[i*4+2])<128);
   }
   const scores={};for(const mode of modes){let differing=0;const worse=[];for(let i=0;i<masks.native.length;i++){differing+=masks.native[i]!==masks[mode][i];if(masks.native[i]===masks.baseline[i]&&masks.native[i]!==masks[mode][i])worse.push([i%size[0]+offset[0],Math.floor(i/size[0])+offset[1]]);}scores[mode]={differing,worse};}return scores;
  },{images,size:o.cropSize,offset:o.cropOffset,modes});
  observations.push({owner:source.owner,zoom:o.zoom,metrics,images:records});
 }
 const result={baselineBorderCanonicalSha256:canonical('src/engine/border-device-layout.js'),baselineEditorCanonicalSha256:canonical('src/engine/canvas-editor.js'),
  clipSha256:sha(readFileSync(folder+'rejected-fill-clip.js')),nativeReferenceSha256:sha(readFileSync(folder+'reference.json')),
  scope:'Historical complete threshold-128 crop comparisons, not full RGB or current renderer equivalence.',observations};
 writeFileSync(join(root,'coupled-pixels.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(observations.map(({owner,zoom,metrics})=>({owner,zoom,metrics}))));
}finally{await browser.close();}
