import{test,expect}from'@playwright/test';
import{readFileSync,writeFileSync}from'node:fs';
import{createHash}from'node:crypto';
import{unzipSync}from'fflate';
const folder='tests/fixtures/border-inheritance/',reference=JSON.parse(readFileSync(folder+'reference.json'));
const sha=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
test('native equivalent cell and table declarations have the same border cross-sections at all eight topologies',async({page})=>{
 await page.goto('/playground.html');const results=[];
 expect(sha(folder+'cases.json')).toBe(reference.casesSha256);
 for(const source of reference.sources){
  expect(sha(folder+source.owner+'.docx')).toBe(source.sourceSha256);
  const rows=[];
  for(const o of source.observations){
   expect(sha(folder+o.crop)).toBe(o.cropSha256);
   const c=JSON.parse(readFileSync(folder+'cases.json')).find(c=>c.id===o.id);
   const actual=await page.evaluate(async({png,o,c})=>{
    const im=new Image();im.src='data:image/png;base64,'+png;await im.decode();if(im.width!==o.cropSize[0]||im.height!==o.cropSize[1])throw Error('Unexpected crop size');
    const cv=document.createElement('canvas');cv.width=im.width;cv.height=im.height;const ctx=cv.getContext('2d');ctx.drawImage(im,0,0);const data=ctx.getImageData(0,0,cv.width,cv.height).data;
    const ink=(x,y)=>Math.max(...data.slice((y*cv.width+x)*4,(y*cv.width+x)*4+3))<128;
    const runs=v=>{const out=[];let start=null;for(let i=0;i<=v.length;i++){if(v[i]&&start===null)start=i;if(!v[i]&&start!==null){out.push([start,i]);start=null;}}return out;};
    const [ox,oy]=o.cropOffset;
    return{vertical:runs(Array.from({length:cv.width},(_,x)=>ink(x,Math.floor(c.yTwips/15)+10-oy))).map(r=>r.map(x=>x+ox)),horizontal:runs(Array.from({length:cv.height},(_,y)=>ink(Math.floor(c.xTwips/15)+10-ox,y))).map(r=>r.map(y=>y+oy))};
   },{png:readFileSync(folder+o.crop).toString('base64'),o,c});
   expect(actual).toEqual({vertical:o.vertical,horizontal:o.horizontal});rows.push(actual);
  }results.push(rows);
 }
 expect(results[0]).toEqual(results[1]);
 // Single-cell controls also disprove the isolated preceding-grid formula.
 expect(results[0][0].horizontal[0]).toEqual([21,22]);
 expect(Math.round(Math.floor((309*5-1)/12)*.16)).toBe(20);
});
test('real imported declarations retain identical painting and exact no-edit package parts',async({page},info)=>{
 await page.goto('/playground.html');const outputs=[];
 for(const source of reference.sources){
  const bytes=readFileSync(folder+source.owner+'.docx');
  const result=await page.evaluate(async bytes=>{
   const{openCanvasDocument}=await import('/src/engine/open-document.js'),{CanvasEditor}=await import('/src/engine/canvas-editor.js');
   const{pkg,images}=await openCanvasDocument(new Uint8Array(bytes)),host=document.createElement('div');document.body.append(host);const errors=[];
   const editor=new CanvasEditor(host,{...pkg,images,onError:e=>errors.push(e.message)});
   try{editor.setZoom(1);editor.paint();return{pages:editor.canvases.length,readOnly:!!pkg.readOnly,issues:pkg.previewIssues||[],errors,png:editor.canvases[0].toDataURL().split(',')[1],exported:[...new Uint8Array(await pkg.export().arrayBuffer())]};}finally{editor.destroy();host.remove();}
  },[...bytes]);
  expect(result.pages).toBe(1);expect(result.readOnly).toBe(false);expect(result.issues).toEqual([]);expect(result.errors).toEqual([]);
  expect(unzipSync(Uint8Array.from(result.exported))).toEqual(unzipSync(bytes));
  writeFileSync(info.outputPath(source.owner+'-noedit.docx'),Uint8Array.from(result.exported));writeFileSync(info.outputPath(source.owner+'-app.png'),Buffer.from(result.png,'base64'));outputs.push(result.png);
 }
 expect(outputs[0]).toBe(outputs[1]);
});
