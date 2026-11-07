import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';

for(const fixture of ['control','holdout'])test(`preserves paired PNG/TIFF pixels, absolute phases and editing: ${fixture}`,async({page},info)=>{
 const folder='tests/fixtures/raster-phase/'+(fixture==='holdout'?'holdout/':'');
 const source=readFileSync(folder+'control.docx'),reference=JSON.parse(readFileSync(folder+'cases.json')),native=JSON.parse(readFileSync(folder+'native-reference.json'));
 expect(createHash('sha256').update(source).digest('hex')).toBe(reference.sourceSha256);
 expect(native.sourceSha256).toBe(reference.sourceSha256);
 if(fixture==='holdout'){
  const properties=JSON.parse(readFileSync(folder+'object-properties.json'));
  expect(properties.sourceSha256).toBe(reference.sourceSha256);expect(properties.referenceBuild).toBe(native.referenceBuild);
  expect([properties.savedBefore,properties.savedAfter]).toEqual([true,true]);expect(properties.shapes).toHaveLength(20);
  for(const c of reference.cases){
   const shape=properties.shapes.find(s=>s.name===c.name);expect(shape,c.name).toBeDefined();
   for(const [field,value] of [['leftPt',c.x],['topPt',c.y],['widthPt',c.width],['heightPt',c.height]])
    expect(shape[field],c.name+' '+field).toBeCloseTo(Math.trunc(Math.round(value*9525)/635)/20,5);
  }
 }
 expect([native.sourceUnchanged,native.savedBefore,native.savedAfter]).toEqual([true,true,true]);
 expect(native.pages).toHaveLength(2);
 for(const p of native.pages){expect(p.repeatIdentical).toBe(true);expect(p.draws).toHaveLength(10);expect(p.imageRgbaSha256).toBe(reference.sourceRgbaSha256);}
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/playground.html');
 const result=await page.evaluate(async({bytes,cases})=>{
  const {openCanvasDocument}=await import('/src/engine/open-document.js');
  const {CanvasEditor}=await import('/src/engine/canvas-editor.js');
  const {pkg,images}=await openCanvasDocument(new Uint8Array(bytes));
  const host=document.createElement('div');document.body.append(host);const editor=new CanvasEditor(host,{...pkg,images});
  const hash=async data=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',data))].map(b=>b.toString(16).padStart(2,'0')).join('');
  const positions=()=>editor.layout.floatingObjects.map(f=>({name:f.image.name,page:f.page+1,x:f.x,y:f.y,width:f.width,height:f.height}));
  const pixels=()=>editor.canvases.map(c=>c.getContext('2d').getImageData(0,0,c.width,c.height).data);
  const save=async()=>[...new Uint8Array(await editor.session.export(pkg).arrayBuffer())];
  try{
   const decoded=[];for(const [assetId,image] of images){
    const c=new OffscreenCanvas(image.width,image.height),ctx=c.getContext('2d');ctx.imageSmoothingEnabled=false;ctx.drawImage(image,0,0);
    decoded.push({assetId,width:image.width,height:image.height,rgbaSha256:await hash(ctx.getImageData(0,0,c.width,c.height).data)});
   }
   const initial=positions(),before=await Promise.all(pixels().map(hash)),pairs=[];
   for(let i=0;i<cases.length;i+=2){
    const c=cases[i],ctx=editor.canvases[c.page-1].getContext('2d'),x=Math.floor(c.x)-4,y=Math.floor(c.y)-4;
    const width=Math.ceil(c.width)+10,height=Math.ceil(c.height)+10;
    const left=ctx.getImageData(x,y,width,height).data,right=ctx.getImageData(x+260,y,width,height).data;
    let differingChannels=0;for(let j=0;j<left.length;j++)if(left[j]!==right[j])differingChannels++;
    pairs.push({name:c.name,differingChannels});
   }
   const noedit=await save();editor.model.select(0,0);editor.execute(()=>editor.model.replace('Reviewed '));const edited=await save();editor.undo();const undo=await save();
   const after=await Promise.all(pixels().map(hash));
   const reopened=await openCanvasDocument(new Uint8Array(edited));
   const reopenedHost=document.createElement('div');document.body.append(reopenedHost);const reopenedEditor=new CanvasEditor(reopenedHost,{...reopened.pkg,images:reopened.images});
   let reopenedPositions,reopenedText;
   try{reopenedPositions=reopenedEditor.layout.floatingObjects.map(f=>({name:f.image.name,page:f.page+1,x:f.x,y:f.y,width:f.width,height:f.height}));reopenedText=reopenedEditor.model.text;}
   finally{reopenedEditor.destroy();reopenedHost.remove();}
   return {readOnly:!!pkg.readOnly,pages:editor.layout.pageCount,decoded,initial,pairs,before,after,reopenedPositions,reopenedText,noedit,edited,undo};
  }finally{editor.destroy();host.remove();}
 },{bytes:[...source],cases:reference.cases});
 expect(result.readOnly).toBe(false);expect(result.pages).toBe(2);expect(result.decoded).toHaveLength(2);
 for(const image of result.decoded){expect([image.width,image.height]).toEqual([625,300]);expect(image.rgbaSha256).toBe(reference.sourceRgbaSha256);}
 const offset=value=>Math.trunc(Math.round(value*9525)/635)/15;
 const declared=reference.cases.map(({name,page,x,y,width,height})=>({name,page,x:offset(x),y:offset(y),width,height}));
 for(const list of [result.initial,result.reopenedPositions]){
  expect(list.map(f=>f.name)).toEqual(declared.map(f=>f.name));
  list.forEach((f,i)=>{expect(f.page).toBe(declared[i].page);for(const field of ['x','y','width','height'])expect(f[field]).toBeCloseTo(declared[i][field],8);});
 }
 expect(result.pairs.every(p=>p.differingChannels===0),JSON.stringify(result.pairs)).toBe(true);
 expect(result.after).toEqual(result.before);expect(result.reopenedText.startsWith('Reviewed ')).toBe(true);
 const original=unzipSync(source);
 for(const type of ['noedit','edited','undo']){
  const data=Buffer.from(result[type]),parts=unzipSync(data);expect(Object.keys(parts).sort()).toEqual(Object.keys(original).sort());
  for(const name of Object.keys(original))if(type!=='edited'||name!=='word/document.xml')expect(Buffer.from(parts[name]).equals(Buffer.from(original[name])),type+' '+name).toBe(true);
  writeFileSync(info.outputPath(type+'.docx'),data);
 }
 expect(errors).toEqual([]);
});

const display=JSON.parse(readFileSync('tests/fixtures/raster-phase/display-reference.json'));
for(const fixture of ['control','holdout'])test(`bitmap screen projection improves the native regions: ${fixture}`,async({page})=>{
 const source=readFileSync('tests/fixtures/raster-phase/'+(fixture==='holdout'?'holdout/':'')+'control.docx');
 const atlas=readFileSync('tests/fixtures/raster-phase/native-bitmap-regions.png');expect(createHash('sha256').update(atlas).digest('hex')).toBe(display.atlasSha256);
 await page.goto('/playground.html');
 const errors=await page.evaluate(async({bytes,atlas,rows})=>{
  const {openCanvasDocument}=await import('/src/engine/open-document.js'),{CanvasEditor}=await import('/src/engine/canvas-editor.js');
  const {pkg,images}=await openCanvasDocument(new Uint8Array(bytes));const host=document.createElement('div');document.body.append(host);const editor=new CanvasEditor(host,{...pkg,images});
  const bitmap=await createImageBitmap(new Blob([new Uint8Array(atlas)],{type:'image/png'}));const c=new OffscreenCanvas(bitmap.width,bitmap.height),native=c.getContext('2d');native.drawImage(bitmap,0,0);bitmap.close();
  const gray=(a,i)=>(a[i]*19595+a[i+1]*38470+a[i+2]*7471+32768)>>16;
  try{return rows.map(row=>{
   editor.setZoom(row.zoom);const [x,y,w,h]=row.box,[nx,ny]=row.nativeBox;
   const a=editor.canvases[row.page-1].getContext('2d').getImageData(x,y,w,h).data,b=native.getImageData(nx,ny,w,h).data;let error=0;
   for(let i=0;i<a.length;i+=4)error+=Math.abs(gray(a,i)-gray(b,i));return error/(w*h);
  });}finally{editor.destroy();host.remove();}
 },{bytes:[...source],atlas:[...atlas],rows:display.observations.filter(r=>r.fixture===fixture)});
 display.observations.filter(r=>r.fixture===fixture).forEach((row,i)=>{
  expect(errors[i],row.name+' '+row.zoom).toBeLessThanOrEqual(row.projectedError+1e-8);
  expect(errors[i],row.name+' improvement').toBeLessThan(row.baselineError);
 });
});

test('DPR2 bitmap regions retain the native 200 percent placement',async({browser},info)=>{
 const context=await browser.newContext({deviceScaleFactor:2,baseURL:info.project.use.baseURL}),page=await context.newPage();
 try{
  const source=readFileSync('tests/fixtures/raster-phase/holdout/control.docx'),atlas=readFileSync('tests/fixtures/raster-phase/native-bitmap-regions.png');
  const rows=display.observations.filter(r=>r.fixture==='holdout'&&r.zoom===2);await page.goto('/playground.html');
  const errors=await page.evaluate(async({bytes,atlas,rows})=>{
   const {openCanvasDocument}=await import('/src/engine/open-document.js'),{CanvasEditor}=await import('/src/engine/canvas-editor.js');
   const {pkg,images}=await openCanvasDocument(new Uint8Array(bytes));const host=document.createElement('div');document.body.append(host);const editor=new CanvasEditor(host,{...pkg,images});
   const bitmap=await createImageBitmap(new Blob([new Uint8Array(atlas)],{type:'image/png'}));const canvas=new OffscreenCanvas(bitmap.width,bitmap.height),native=canvas.getContext('2d');native.drawImage(bitmap,0,0);bitmap.close();
   const gray=(a,i)=>(a[i]*19595+a[i+1]*38470+a[i+2]*7471+32768)>>16;
   try{return rows.map(row=>{
    if(editor.canvases[row.page-1].width!==1536)throw Error('Expected DPR2 canvas');
    const [x,y,w,h]=row.box,[nx,ny]=row.nativeBox,a=editor.canvases[row.page-1].getContext('2d').getImageData(x,y,w,h).data,b=native.getImageData(nx,ny,w,h).data;let error=0;
    for(let i=0;i<a.length;i+=4)error+=Math.abs(gray(a,i)-gray(b,i));return error/(w*h);
   });}finally{editor.destroy();host.remove();}
  },{bytes:[...source],atlas:[...atlas],rows});
  rows.forEach((row,i)=>expect(errors[i],row.name).toBeLessThanOrEqual(row.projectedError+1e-8));
 }finally{await context.close();}
});
