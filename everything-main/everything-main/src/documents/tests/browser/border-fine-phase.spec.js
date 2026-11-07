import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';

test.setTimeout(180000);

const folder='tests/fixtures/border-fine-phase/';
const reference=JSON.parse(readFileSync(folder+'reference.json'));
const cases=JSON.parse(readFileSync(folder+'cases.json'));
const sha=file=>createHash('sha256').update(readFileSync(file)).digest('hex');

test('native fine phase independently locates the 308/309 twip boundary',async({page})=>{
 await page.goto('/playground.html');
 expect(sha(folder+'control.docx')).toBe(reference.sourceSha256);
 expect(sha(folder+'cases.json')).toBe(reference.casesSha256);
 expect(sha(folder+'capture.json')).toBe(reference.captureSha256);
 expect(sha(folder+'native.emf.gz')).toBe(reference.emfSha256);
 const normalized=[];
 for(const [index,c] of cases.entries()){
  const o=reference.observations[index];expect(o.id).toBe(c.id);
  expect(sha(folder+o.crop)).toBe(o.cropSha256);
  const actual=await page.evaluate(async({png,o,c})=>{
   const im=new Image();im.src='data:image/png;base64,'+png;await im.decode();
   if(im.width!==o.cropSize[0]||im.height!==o.cropSize[1])throw Error('Unexpected crop size');
   const cv=document.createElement('canvas');cv.width=im.width;cv.height=im.height;
   const ctx=cv.getContext('2d');ctx.drawImage(im,0,0);const data=ctx.getImageData(0,0,cv.width,cv.height).data;
   const ink=(x,y)=>Math.max(...data.slice((y*cv.width+x)*4,(y*cv.width+x)*4+3))<128;
   const runs=v=>{const out=[];let start=null;for(let i=0;i<=v.length;i++){if(v[i]&&start===null)start=i;if(!v[i]&&start!==null){out.push([start,i]);start=null;}}return out;};
   const [ox,oy]=o.cropOffset;
   return {vertical:runs(Array.from({length:cv.width},(_,x)=>ink(x,Math.floor(c.yTwips/15)+10-oy))).map(r=>r.map(x=>x+ox)),
    horizontal:runs(Array.from({length:cv.height},(_,y)=>ink(Math.floor(c.xTwips/15)+10-ox,y))).map(r=>r.map(y=>y+oy))};
  },{png:readFileSync(folder+o.crop).toString('base64'),o,c});
  expect(actual).toEqual({vertical:o.vertical,horizontal:o.horizontal});
  normalized.push(actual.horizontal.map(r=>r.map(y=>y-100*Math.floor(index/4))));
 }
 expect(normalized.slice(0,8)).toEqual(Array(8).fill([[20,21],[99,100]]));
 expect(normalized.slice(8)).toEqual(Array(9).fill([[21,22],[100,101]]));
 expect(Math.round(Math.floor((309*5-1)/12)*.16)).toBe(20);
});

test('fine-phase import paints all 17 tables and preserves the package',async({page},info)=>{
 await page.goto('/playground.html');
 const bytes=readFileSync(folder+'control.docx');
 const result=await page.evaluate(async ({bytes,cases})=>{
  const {openCanvasDocument}=await import('/src/engine/open-document.js');
  const {CanvasEditor}=await import('/src/engine/canvas-editor.js');
  const {pkg,images}=await openCanvasDocument(new Uint8Array(bytes));
  const host=document.createElement('div');document.body.append(host);const errors=[];
  const editor=new CanvasEditor(host,{...pkg,images,onError:e=>errors.push(e.message)});
  try{
   const cv=document.createElement('canvas');cv.width=384;cv.height=576;
   const ctx=cv.getContext('2d');ctx.drawImage(editor.canvases[0],0,0,384,576);
   const data=ctx.getImageData(0,0,384,576).data;
   const ink=(x,y)=>Math.max(...data.slice((y*384+x)*4,(y*384+x)*4+3))<128;
   const runs=v=>{const out=[];let start=null;for(let i=0;i<=v.length;i++){if(v[i]&&start===null)start=i;if(!v[i]&&start!==null){out.push([start,i]);start=null;}}return out;};
   const observations=cases.map(c=>{
    const x=Math.floor(c.xTwips/15),y=Math.floor(c.yTwips/15);
    return {id:c.id,vertical:runs(Array.from({length:75},(_,dx)=>ink(x-5+dx,y+10))).map(r=>r.map(n=>n+x-5)),
     horizontal:runs(Array.from({length:92},(_,dy)=>ink(x+10,y-5+dy))).map(r=>r.map(n=>n+y-5))};
   });
   return {observations,pages:editor.canvases.length,readOnly:!!pkg.readOnly,issues:pkg.previewIssues||[],errors,
   png:editor.printSheets()[0].toDataURL().split(',')[1],tables:Object.keys(pkg.tables).length,
   exported:[...new Uint8Array(await editor.export(pkg).arrayBuffer())]};}
  finally{editor.destroy();host.remove();}
 },{bytes:[...bytes],cases});
 expect(result.pages).toBe(1);expect(result.readOnly).toBe(false);expect(result.issues).toEqual([]);expect(result.errors).toEqual([]);
 expect(result.tables).toBe(17);expect(unzipSync(Uint8Array.from(result.exported))).toEqual(unzipSync(bytes));
 writeFileSync(info.outputPath('fine-phase-noedit.docx'),Uint8Array.from(result.exported));
 writeFileSync(info.outputPath('fine-phase-print.png'),Buffer.from(result.png,'base64'));
 // Diagnostic output does not bless today's mismatch as expected rendering.
 writeFileSync(info.outputPath('fine-phase-comparison.json'),JSON.stringify({native:reference.observations.map(({id,vertical,horizontal})=>({id,vertical,horizontal})),actual:result.observations},null,2));
});
