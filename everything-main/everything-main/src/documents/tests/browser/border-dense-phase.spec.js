import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
const folder='tests/fixtures/border-dense-phase/';
const cases=JSON.parse(readFileSync(folder+'cases.json'));
const ref=JSON.parse(readFileSync(folder+'reference.json'));

test('native complete phase sweep rejects both ordinary nearest and preceding-600-DPI origins',async({page})=>{
 await page.goto('/playground.html');
 const actual=await page.evaluate(async({png,cases})=>{
  const image=new Image();image.src='data:image/png;base64,'+png;await image.decode();
  if(image.width!==384||image.height!==288)throw Error('Unexpected native crop size');
  const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
  const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);const data=ctx.getImageData(0,0,384,288).data;
  const ink=(x,y)=>Math.max(...data.slice((y*384+x)*4,(y*384+x)*4+3))<128;
  const runs=v=>{const out=[];let start=null;for(let i=0;i<=v.length;i++){if(v[i]&&start===null)start=i;if(!v[i]&&start!==null){out.push([start,i]);start=null;}}return out;};
  return cases.map(c=>{const x=Math.floor(c.xTwips/15),y=Math.floor(c.yTwips/15);return{id:c.id,
   vertical:runs(Array.from({length:72},(_,i)=>ink(x-3+i,y+3))).map(r=>r.map(v=>v+x-3)),
   horizontal:runs(Array.from({length:15},(_,i)=>ink(x+10,y-3+i))).map(r=>r.map(v=>v+y-3))};});
 },{png:readFileSync(folder+'native-100.png').toString('base64'),cases});
 expect(actual).toEqual(ref.observations);
 const preceding=cases.filter((c,i)=>Math.round(Math.floor((c.yTwips*5-1)/12)*.16)!==actual[i].horizontal[0][0]);
 expect(preceding.map(c=>c.id)).toEqual([37,38,39,40]);
 const nearest=cases.filter((c,i)=>Math.round(c.yTwips/15)!==actual[i].horizontal[0][0]);
 expect(nearest.map(c=>c.id)).toEqual([33,34,35,36]);
 // Half-grid leading bias fits these tops, but is not evidence for a universal border rule.
 for(const [i,c] of cases.entries())expect(Math.round(c.yTwips/15-.08)).toBe(actual[i].horizontal[0][0]);
 // A proposed trailing-edge minimum-width rule fails at phase seven.
 const c=cases[28],native=actual[28].horizontal[1];
 expect(native).toEqual([143,144]);
 expect(Math.round((c.yTwips+c.heightTwips)/15+1/3-.08)).toBe(145);
});

test('native 200% split captures agree in their overlap and retain all sixty measured frames',async({page})=>{
 await page.goto('/playground.html');const ref=JSON.parse(readFileSync(folder+'reference-200.json'));
 const measured=await page.evaluate(async({crops,cases,observations})=>{
  const images={};
  for(const crop of crops){const image=new Image();image.src='data:image/png;base64,'+crop.png;await image.decode();
   if(image.width!==768||image.height!==299)throw Error('Unexpected crop dimensions');
   const canvas=document.createElement('canvas');canvas.width=768;canvas.height=299;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);
   images[crop.name]={data:ctx.getImageData(0,0,768,299).data,offset:crop.cropOffset};
  }
  const ink=(name,x,y)=>{const image=images[name],i=((y-image.offset[1])*768+x)*4;return Math.max(...image.data.slice(i,i+3))<128;};
  let overlap=0;for(let y=277;y<299;y++)for(let x=1;x<767;x++)overlap+=ink('top',x,y)!==ink('bottom',x,y);
  const runs=v=>{const out=[];let start=null;for(let i=0;i<=v.length;i++){if(v[i]&&start===null)start=i;if(!v[i]&&start!==null){out.push([start,i]);start=null;}}return out;};
  return{overlap,rows:cases.map((c,i)=>{const x=Math.floor(c.xTwips*2/15),y=Math.floor(c.yTwips*2/15),name=observations[i].crop;
   return{id:c.id,crop:name,vertical:runs(Array.from({length:138},(_,i)=>ink(name,x-4+i,y+5))).map(r=>r.map(v=>v+x-4)),
    horizontal:runs(Array.from({length:23},(_,i)=>ink(name,x+20,y-3+i))).map(r=>r.map(v=>v+y-3))};})};
 },{crops:ref.crops.map(c=>({...c,png:readFileSync(folder+c.crop).toString('base64')})),cases,observations:ref.observations});
 expect(measured.overlap).toBe(0);expect(measured.rows).toEqual(ref.observations);
 for(const [i,c] of cases.entries()){
  expect(measured.rows[i].horizontal[0][0]).toBe(Math.round(c.yTwips*2/15-.16));
  expect(measured.rows[i].horizontal[1][0]).toBe(Math.floor((c.yTwips+c.heightTwips)*2/15));
 }
 // The 100% one-pixel inset rule fails even with the same authored thickness.
 expect(measured.rows[0].horizontal).toEqual([[48,49],[64,65]]);
 expect(Math.round((cases[0].yTwips+cases[0].heightTwips)*2/15-.16)-1).toBe(63);
 // Preserving the nearest-rounded baseline bottom also fails, at phase four.
 expect(measured.rows[16].horizontal[1]).toEqual([192,193]);
 expect(Math.round((cases[16].yTwips+cases[16].heightTwips)*2/15)).toBe(193);
});

test('175% complete sweep rejects continuous bias and preceding-1200-DPI leading origins',async({page})=>{
 await page.goto('/playground.html');const ref=JSON.parse(readFileSync(folder+'reference-175.json'));
 const result=await page.evaluate(async({crops,cases,observations,overlap})=>{
  const images={};
  for(const c of crops){const image=new Image();image.src='data:image/png;base64,'+c.png;await image.decode();
   if(image.width!==c.cropSize[0]||image.height!==c.cropSize[1])throw Error('Crop dimensions changed');
   const cv=document.createElement('canvas');cv.width=image.width;cv.height=image.height;const ctx=cv.getContext('2d');ctx.drawImage(image,0,0);
   images[c.name]={data:ctx.getImageData(0,0,cv.width,cv.height).data,width:cv.width,offset:c.cropOffset};
  }
  const ink=(name,x,y)=>{const image=images[name],i=((y-image.offset[1])*image.width+x)*4;return Math.max(...image.data.slice(i,i+3))<128;};
  let differing=0;for(let y=overlap.offset[1];y<overlap.offset[1]+overlap.size[1];y++)for(let x=overlap.offset[0];x<overlap.offset[0]+overlap.size[0];x++)differing+=ink('top',x,y)!==ink('bottom',x,y);
  const runs=v=>{const out=[];let start=null;for(let i=0;i<=v.length;i++){if(v[i]&&start===null)start=i;if(!v[i]&&start!==null){out.push([start,i]);start=null;}}return out;};
  return{differing,rows:cases.map((c,i)=>{const x=Math.floor(c.xTwips*7/60),y=Math.floor(c.yTwips*7/60),name=observations[i].crop;
   return{id:c.id,crop:name,vertical:runs(Array.from({length:122},(_,i)=>ink(name,x-4+i,y+5))).map(r=>r.map(v=>v+x-4)),
    horizontal:runs(Array.from({length:21},(_,i)=>ink(name,x+20,y-3+i))).map(r=>r.map(v=>v+y-3))};})};
 },{crops:ref.crops.map(c=>({...c,png:readFileSync(folder+c.crop).toString('base64')})),cases,observations:ref.observations,overlap:ref.overlap});
 expect(result.differing).toBe(0);expect(result.rows).toEqual(ref.observations);
 const bias=cases.filter((c,i)=>Math.round((c.yTwips/15-.08)*1.75)!==result.rows[i].horizontal[0][0]);
 const grid=cases.filter((c,i)=>Math.round(Math.floor((c.yTwips*5-1)/6)*.08*1.75)!==result.rows[i].horizontal[0][0]);
 expect(bias.map(c=>c.id)).toEqual([57,58,59,60]);expect(grid.map(c=>c.id)).toEqual([21,22,23,24]);
 for(const [i,c] of cases.entries())expect(Math.round((c.yTwips-1)*7/60)).toBe(result.rows[i].horizontal[0][0]);
 expect(result.rows[56].horizontal[0]).toEqual([436,437]);expect(result.rows[20].horizontal[0]).toEqual([182,183]);
});

for(const zoom of [1,1.75,2])test(`dense original remains editable at ${zoom*100}%, paints one page and exports unchanged parts`,async({page},info)=>{
 await page.goto('/playground.html');const bytes=readFileSync(folder+'control.docx');
 const result=await page.evaluate(async ({bytes,zoom})=>{
  const {openCanvasDocument}=await import('/src/engine/open-document.js'),{CanvasEditor}=await import('/src/engine/canvas-editor.js');
  const {pkg,images}=await openCanvasDocument(new Uint8Array(bytes)),host=document.createElement('div');document.body.append(host);const errors=[];
  const editor=new CanvasEditor(host,{...pkg,images,onError:e=>errors.push(e.message)});
  try{editor.setZoom(zoom);editor.paint();return{pages:editor.canvases.length,cells:editor.layout.cells.length,readOnly:!!pkg.readOnly,issues:pkg.previewIssues||[],errors,
   png:editor.canvases[0].toDataURL().split(',')[1],exported:[...new Uint8Array(await pkg.export().arrayBuffer())]};}finally{editor.destroy();host.remove();}
 },{bytes:[...bytes],zoom});
 expect(result.pages).toBe(1);expect(result.cells).toBe(60);expect(result.readOnly).toBe(false);expect(result.issues).toEqual([]);expect(result.errors).toEqual([]);
 expect(unzipSync(Uint8Array.from(result.exported))).toEqual(unzipSync(bytes));
 writeFileSync(info.outputPath('app.png'),Buffer.from(result.png,'base64'));
});
