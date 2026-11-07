import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

for(const fixture of ['print-row-width-phase','print-paper-phase','print-high-row-phase','print-paper-height-phase','print-tie-phase']){
 for(const axis of ['horizontal','vertical'])test(`native section ${axis} border geometry: ${fixture}`,async({page},info)=>{
  const root=`tests/fixtures/${fixture}/`,native=JSON.parse(readFileSync(root+'native-print-frames.json'));
  for(const [file,hash]of [['control.docx',native.sourceSha256],['cases.json',native.casesSha256],['native.pdf',native.pdfSha256]])
   expect(createHash('sha256').update(readFileSync(root+file)).digest('hex')).toBe(hash);
  await page.goto('/playground.html');
  const actual=await page.evaluate(async bytes=>{
   const {openCanvasDocument}=await import('/src/engine/open-document.js');
   const {CanvasEditor}=await import('/src/engine/canvas-editor.js');
   const {deviceTableBorders}=await import('/src/engine/border-device-layout.js');
   const {paintTableBorder}=await import('/src/engine/canvas-table-borders.js');
   const {pkg,images}=await openCanvasDocument(Uint8Array.from(bytes));
   const host=document.createElement('div');document.body.append(host);const editor=new CanvasEditor(host,{...pkg,images});
   try{
    const groups=new Map(),ctx={getTransform:()=>({a:2,b:0,c:0,d:2,e:0,f:0})};
    const painted=editor.layout.pages.flatMap((geometry,index)=>deviceTableBorders(ctx,editor.layout.tableBorders.filter(s=>s.page===index),true,geometry));
    for(const s of painted)if(!s.guide){
     if(!groups.has(s.tableId))groups.set(s.tableId,{page:s.page,size:s.border.size,rects:[]});
     paintTableBorder({save(){},restore(){},fillRect(x,y,w,h){groups.get(s.tableId).rects.push([x*.75,y*.75,w*.75,h*.75]);}},s);
    }
    return {readOnly:!!pkg.readOnly,pages:editor.layout.pages.map(p=>[p.width*.75,p.height*.75]),
     frames:[...groups.values()].map(g=>({page:g.page,size:g.size,boundsPt:[
      Math.min(...g.rects.map(r=>r[0])),Math.min(...g.rects.map(r=>r[1])),
      Math.max(...g.rects.map(r=>r[0]+r[2])),Math.max(...g.rects.map(r=>r[1]+r[3]))]}))};
   }finally{editor.destroy();host.remove();}
  },[...readFileSync(root+'control.docx')]);
  await info.attach('native-section-frames',{body:JSON.stringify({native,actual},null,2),contentType:'application/json'});
  expect(actual.readOnly).toBe(false);expect(actual.pages).toHaveLength(native.pageCount);
  expect(actual.frames).toHaveLength(native.frames.length);
  for(const [i,frame]of actual.frames.entries()){
   const reference=native.frames[i];expect(frame.page).toBe(reference.page);expect(frame.size).toBe(reference.sizeEighthPoints);
   expect(actual.pages[i]).toEqual([reference.pageWidthPt||612,reference.pageHeightPt||792]);
   expect(frame.boundsPt.every(Number.isFinite)).toBe(true);
  }
  for(const [i,frame]of actual.frames.entries())for(const edge of [0,2])
   expect(Math.abs(frame.boundsPt[edge]-native.frames[i].boundsPt[edge]),`case ${i} edge ${edge}`).toBeLessThan(.01);
  if(axis==='vertical'){
   test.fail(true,'Native vertical row and coordinate phases remain incomplete; horizontal edges and structural checks above must pass.');
   for(const [i,frame]of actual.frames.entries())for(const edge of [1,3])
    expect(Math.abs(frame.boundsPt[edge]-native.frames[i].boundsPt[edge]),`case ${i} edge ${edge}`).toBeLessThan(.01);
  }
 });
}

test('printSheets uses each section paper width and preserves source/screen geometry',async({page},info)=>{
 const root='tests/fixtures/print-paper-phase/',native=JSON.parse(readFileSync(root+'native-print-frames.json'));
 const source=readFileSync(root+'control.docx');
 for(const [file,hash]of [['control.docx',native.sourceSha256],['cases.json',native.casesSha256],['native.pdf',native.pdfSha256]])
  expect(createHash('sha256').update(readFileSync(root+file)).digest('hex')).toBe(hash);
 await page.goto('/playground.html');
 const result=await page.evaluate(async bytes=>{
  const {openCanvasDocument}=await import('/src/engine/open-document.js');
  const {CanvasEditor}=await import('/src/engine/canvas-editor.js');
  const {pkg,images}=await openCanvasDocument(Uint8Array.from(bytes));
  const host=document.createElement('div');document.body.append(host);const editor=new CanvasEditor(host,{...pkg,images});
  const original=CanvasRenderingContext2D.prototype.fillRect;
  try{
   const screen=editor.canvases.map(c=>c.toDataURL()),layout=JSON.stringify(editor.layout),rectangles=new Map();
   CanvasRenderingContext2D.prototype.fillRect=function(x,y,w,h){
    if(this.fillStyle.toLowerCase()==='#6d7f91'){
     if(!rectangles.has(this.canvas))rectangles.set(this.canvas,[]);
     rectangles.get(this.canvas).push([x*.75,y*.75,w*.75,h*.75]);
    }
    return original.call(this,x,y,w,h);
   };
   let sheets;
   try{sheets=editor.printSheets();}finally{CanvasRenderingContext2D.prototype.fillRect=original;}
   const bounds=sheets.map(c=>{const r=rectangles.get(c);if(!r?.length)throw Error('No border ink captured');return [Math.min(...r.map(v=>v[0])),Math.max(...r.map(v=>v[0]+v[2]))];});
   const first=sheets.map(c=>c.toDataURL());editor.paint();
   const screenUnchanged=JSON.stringify(screen)===JSON.stringify(editor.canvases.map(c=>c.toDataURL()));
   editor.setZoom(2);const second=editor.printSheets().map(c=>c.toDataURL());
   return {bounds,screenUnchanged,sourceUnchanged:layout===JSON.stringify(editor.layout),printSame:JSON.stringify(first)===JSON.stringify(second)};
  }finally{CanvasRenderingContext2D.prototype.fillRect=original;editor.destroy();host.remove();}
 },[...source]);
 await info.attach('actual-section-print-ink',{body:JSON.stringify(result,null,2),contentType:'application/json'});
 expect(result.bounds).toHaveLength(8);expect(result.screenUnchanged).toBe(true);expect(result.sourceUnchanged).toBe(true);expect(result.printSame).toBe(true);
 for(const [i,edges]of result.bounds.entries())for(const [index,edge]of [0,2].entries())
  expect(Math.abs(edges[index]-native.frames[i].boundsPt[edge]),`section ${i} edge ${edge}`).toBeLessThan(.01);
});
