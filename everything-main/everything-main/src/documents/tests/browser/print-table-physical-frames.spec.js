import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

function fixtureData(fixture){
 const root=`tests/fixtures/${fixture}/`;
 const native=JSON.parse(readFileSync(root+'native-print-frames.json'));
 const source=readFileSync(root+(fixture==='border-device-pixels'?'control-15.docx':'control.docx'));
 expect(createHash('sha256').update(source).digest('hex')).toBe(native.sourceSha256);
 expect(createHash('sha256').update(readFileSync(root+(fixture==='border-device-pixels'?'native-15.pdf':'native.pdf'))).digest('hex')).toBe(native.pdfSha256);
 if(native.casesSha256)expect(createHash('sha256').update(readFileSync(root+'cases.json')).digest('hex')).toBe(native.casesSha256);
 return {native,source};
}
async function measureFrames(page,source,pageCount=1){
 await page.goto('/playground.html');
 const frames=await page.evaluate(async({bytes,pageCount})=>{
  const {openCanvasDocument}=await import('/src/engine/open-document.js');
  const {CanvasEditor}=await import('/src/engine/canvas-editor.js');
  const {deviceTableBorders}=await import('/src/engine/border-device-layout.js');
  const {paintTableBorder}=await import('/src/engine/canvas-table-borders.js');
  const {pkg,images}=await openCanvasDocument(Uint8Array.from(bytes));
  const host=document.createElement('div');document.body.append(host);
  const editor=new CanvasEditor(host,{...pkg,images});
  try{
   if(editor.layout.pages.length!==pageCount)throw Error(`Expected ${pageCount} pages, got ${editor.layout.pages.length}`);
   const ctx={getTransform:()=>({a:2,b:0,c:0,d:2,e:0,f:0})};
   const groups=new Map();
   const painted=editor.layout.pages.flatMap((geometry,index)=>deviceTableBorders(ctx,editor.layout.tableBorders.filter(s=>s.page===index),true,geometry));
   for(const s of painted)if(!s.guide){
    if(!groups.has(s.tableId))groups.set(s.tableId,{size:s.border.size,page:s.page,rects:[]});
    const group=groups.get(s.tableId);
    paintTableBorder({save(){},restore(){},fillRect(x,y,w,h){group.rects.push([x*.75,y*.75,w*.75,h*.75]);}},s);
   }
   return [...groups.values()].map(g=>({size:g.size,page:g.page,boundsPt:[
    Math.min(...g.rects.map(r=>r[0])),Math.min(...g.rects.map(r=>r[1])),
    Math.max(...g.rects.map(r=>r[0]+r[2])),Math.max(...g.rects.map(r=>r[1]+r[3]))]}));
  }finally{editor.destroy();host.remove();}
 },{bytes:[...source],pageCount});
 return frames;
}
function checkFrames(frames,native){
 expect(frames).toHaveLength(native.frames.length);
 for(const [i,frame]of frames.entries()){
  expect(frame.size).toBe(native.frames[i].sizeEighthPoints);
  if(native.frames[i].page!==undefined)expect(frame.page).toBe(native.frames[i].page);
  expect(frame.boundsPt.every(Number.isFinite)).toBe(true);
 }
}
for(const fixture of ['border-device-pixels','print-border-phase','print-frame-grid','print-row-phase','print-row-pen-phase']){
 test(`physical horizontal frame edges match the native grid phases: ${fixture}`,async({page},info)=>{
  const {native,source}=fixtureData(fixture),frames=await measureFrames(page,source,native.pageCount||1);
  await info.attach('physical-horizontal-frames',{body:JSON.stringify({native:native.frames,actual:frames},null,2),contentType:'application/json'});
  checkFrames(frames,native);
  for(const [i,frame]of frames.entries())for(const edge of [0,2])expect(Math.abs(frame.boundsPt[edge]-native.frames[i].boundsPt[edge]),`case ${i} horizontal edge ${edge}`).toBeLessThan(.01);
 });
 test(`physical vertical frame placement retains its native regression: ${fixture}`,async({page},info)=>{
 const {native,source}=fixtureData(fixture),frames=await measureFrames(page,source,native.pageCount||1);
 await info.attach('physical-frame-comparison',{body:JSON.stringify({native:native.frames,actual:frames},null,2),contentType:'application/json'});
 checkFrames(frames,native);
 for(const [i,frame]of frames.entries())for(const edge of [0,2])expect(Math.abs(frame.boundsPt[edge]-native.frames[i].boundsPt[edge])).toBeLessThan(.01);
 test.fail(true,'Vertical table frame flow/row-height phases still diverge from the native PDF; horizontal and pen agreement alone is insufficient.');
 for(const [i,frame] of frames.entries()){
  for(const edge of [1,3])expect(Math.abs(frame.boundsPt[edge]-native.frames[i].boundsPt[edge]),`${frame.size}/8pt frame edge ${edge}`).toBeLessThan(.02);
 }
});
}
