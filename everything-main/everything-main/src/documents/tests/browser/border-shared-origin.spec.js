import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
for(const zoom of [100,200])test(`native ${zoom}% connected-table PNGs reproduce identical ownership-independent ink`,async({page})=>{
 await page.goto('/playground.html');const ref=JSON.parse(readFileSync('tests/fixtures/border-shared-origin/reference.json')),matrices=[];
 for(const source of ref.sources){const o=source.observations.find(o=>o.zoom===zoom);
  const result=await page.evaluate(async({png,o})=>{const im=new Image();im.src='data:image/png;base64,'+png;await im.decode();if(im.width!==o.cropSize[0]||im.height!==o.cropSize[1])throw Error('Unexpected native crop dimensions');
   const canvas=document.createElement('canvas');canvas.width=im.width;canvas.height=im.height;const ctx=canvas.getContext('2d');ctx.drawImage(im,0,0);const data=ctx.getImageData(0,0,im.width,im.height).data;
   const ink=Array.from({length:im.width*im.height},(_,i)=>Math.max(data[i*4],data[i*4+1],data[i*4+2])<128);
   const runs=values=>{const out=[];let start=null;for(let i=0;i<=values.length;i++){if(values[i]&&start===null)start=i;if(!values[i]&&start!==null){out.push([start,i]);start=null;}}return out;};
   const z=o.zoom/100,[ox,oy]=o.cropOffset,vertical=runs(Array.from({length:im.width},(_,x)=>ink[(35*z-oy)*im.width+x])).map(r=>r.map(x=>x+ox));
   const horizontal=runs(Array.from({length:im.height},(_,y)=>ink[y*im.width+35*z-ox])).map(r=>r.map(y=>y+oy));return{ink,vertical,horizontal};
  },{png:readFileSync('tests/fixtures/border-shared-origin/'+o.crop).toString('base64'),o});
  expect(result.vertical).toEqual(o.vertical);expect(result.horizontal).toEqual(o.horizontal);matrices.push(result.ink);
 }
 expect(matrices[0]).toEqual(matrices[1]);
});
test('equivalent authored shared-border owners keep identical ink; the archived leading-only candidate breaks that invariant',async({page},info)=>{
 await page.goto('/playground.html');
 const results=[];
 for(const owner of ['top','bottom']){
  const bytes=readFileSync(`tests/fixtures/border-shared-origin/${owner}.docx`);
  const result=await page.evaluate(async bytes=>{
   const {openCanvasDocument}=await import('/src/engine/open-document.js'),{CanvasEditor}=await import('/src/engine/canvas-editor.js');
   const {deviceTableBorders}=await import('/src/engine/border-device-layout.js'),{deviceTableBorders:rejected}=await import('/tests/fixtures/border-shared-origin/rejected-candidate.js');
   const {paintTableBorder}=await import('/src/engine/canvas-table-borders.js');
   const {pkg,images}=await openCanvasDocument(new Uint8Array(bytes)),host=document.createElement('div');document.body.append(host);const errors=[];
   const editor=new CanvasEditor(host,{...pkg,images,onError:e=>errors.push(e.message)});
   try{
    const source=editor.layout.tableBorders,before=JSON.stringify(source),out=[];
    for(const scale of [1,2])for(const [name,convert]of [['current',deviceTableBorders],['rejected',rejected]]){
     const canvas=document.createElement('canvas');canvas.width=400*scale;canvas.height=200*scale;const ctx=canvas.getContext('2d');ctx.scale(scale,scale);ctx.fillStyle='#FFFFFF';ctx.fillRect(0,0,400,200);
     const borders=convert(ctx,source);for(const s of borders)if(!s.guide)paintTableBorder(ctx,s);
     out.push({name,scale,png:canvas.toDataURL().split(',')[1],shared:borders.filter(s=>s.horizontal&&s.cellIds.length===2).map(({x,y,width,height})=>({x,y,width,height}))});
    }
    return {pages:editor.canvases.length,readOnly:!!pkg.readOnly,issues:pkg.previewIssues||[],errors,unchanged:before===JSON.stringify(source),out,exported:[...new Uint8Array(await pkg.export().arrayBuffer())]};
   }finally{editor.destroy();host.remove();}
  },[...bytes]);
  expect(result.pages).toBe(1);expect(result.readOnly).toBe(false);expect(result.issues).toEqual([]);expect(result.errors).toEqual([]);expect(result.unchanged).toBe(true);
  expect(unzipSync(Uint8Array.from(result.exported))).toEqual(unzipSync(bytes));writeFileSync(info.outputPath(owner+'-noedit.docx'),Uint8Array.from(result.exported));delete result.exported;
  for(const o of result.out)writeFileSync(info.outputPath(`${owner}-${o.name}-${o.scale}.png`),Buffer.from(o.png,'base64'));
  results.push({owner,...result});
 }
 for(const scale of [1,2])expect(results[0].out.find(o=>o.name==='current'&&o.scale===scale)).toEqual(results[1].out.find(o=>o.name==='current'&&o.scale===scale));
 const first=results[0].out.find(o=>o.name==='rejected'&&o.scale===1),second=results[1].out.find(o=>o.name==='rejected'&&o.scale===1);
 expect(first.shared.map(s=>s.y)).toEqual([60,60]);expect(second.shared.map(s=>s.y)).toEqual([61,61]);expect(first.png).not.toBe(second.png);
 for(const r of results)for(const o of r.out)delete o.png;
 writeFileSync(info.outputPath('shared-origin.json'),JSON.stringify(results,null,2));
});
