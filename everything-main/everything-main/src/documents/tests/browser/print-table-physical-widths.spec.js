import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

const root='tests/fixtures/border-device-pixels/';
const manifest=JSON.parse(readFileSync(root+'manifest.json'));
for(const mode of [15])test(`print retains physical border widths independently of screen projection: mode ${mode}`,async({page},info)=>{
 const bytes=readFileSync(root+`control-${mode}.docx`);
 expect(createHash('sha256').update(bytes).digest('hex')).toBe(manifest[`control-${mode}.docx`]);
 expect(createHash('sha256').update(readFileSync(root+'native-15.pdf')).digest('hex')).toBe(manifest['native-15.pdf']);
 await page.goto('/playground.html');
 const result=await page.evaluate(async bytes=>{
  const {openCanvasDocument}=await import('/src/engine/open-document.js');
  const {CanvasEditor}=await import('/src/engine/canvas-editor.js');
  const {pkg,images}=await openCanvasDocument(Uint8Array.from(bytes));
  const host=document.createElement('div');document.body.append(host);
  const editor=new CanvasEditor(host,{...pkg,images});
  try{
   editor.setZoom(2);
   const before=editor.canvases.map(c=>c.toDataURL()),layout=JSON.stringify(editor.layout);
   const printed=editor.printSheets(),canvas=printed[0],ctx=canvas.getContext('2d');
   const samples=editor.layout.tableBorders.filter(s=>!s.guide&&s.horizontal&&s.side==='top').map(s=>{
    const x=Math.round((s.x+s.width/2)*2),y=Math.floor(s.y*2)-3,h=Math.ceil(s.height*2)+7;
    const d=ctx.getImageData(x,y,1,h).data;let coverage=0;
    for(let i=0;i<d.length;i+=4)coverage+=(255-d[i])/(255-109);
    return {size:s.border.size,coverage,physicalPixels:s.height*2};
   });
   editor.paint();
   const unchanged=layout===JSON.stringify(editor.layout)&&JSON.stringify(before)===JSON.stringify(editor.canvases.map(c=>c.toDataURL()));
   const screenAfterPrint=editor.canvases.map(c=>c.toDataURL());
   editor.setZoom(1);const second=editor.printSheets().map(c=>c.toDataURL());
   editor.setZoom(2);editor.paint();
   return {samples,unchanged,printSame:JSON.stringify(second)===JSON.stringify(printed.map(c=>c.toDataURL())),screenSame:JSON.stringify(screenAfterPrint)===JSON.stringify(editor.canvases.map(c=>c.toDataURL())),pages:printed.length};
  }finally{editor.destroy();host.remove();}
 },[...bytes]);
 await info.attach('physical-border-widths',{body:JSON.stringify(result,null,2),contentType:'application/json'});
 expect(result.unchanged).toBe(true);expect(result.printSame).toBe(true);expect(result.screenSame).toBe(true);
 expect(result.pages).toBe(1);expect(result.samples).toHaveLength(6);
 // Independent native PDF rectangles, source/PDF hashes verified above.
 const nativeWidths=new Map([[2,.24],[4,.48],[6,.72],[8,.96],[12,1.44],[16,1.92]]);
 for(const sample of result.samples){
  expect(Math.abs(sample.coverage*.375-nativeWidths.get(sample.size)),`${sample.size}/8pt native printed width`).toBeLessThan(.02);
 }
});

test('all sixteen native physical pens paint independently of raster scale and screen zoom',async({page},info)=>{
 const root='tests/fixtures/print-border-phase/',native=JSON.parse(readFileSync(root+'native-print-frames.json'));
 const source=readFileSync(root+'control.docx');
 for(const [file,hash]of [['control.docx',native.sourceSha256],['native.pdf',native.pdfSha256],['cases.json',native.casesSha256]])expect(createHash('sha256').update(readFileSync(root+file)).digest('hex')).toBe(hash);
 await page.goto('/playground.html');
 const result=await page.evaluate(async bytes=>{
  const {openCanvasDocument}=await import('/src/engine/open-document.js');
  const {CanvasEditor}=await import('/src/engine/canvas-editor.js');
  const {deviceTableBorders}=await import('/src/engine/border-device-layout.js');
  const {paintTableBorder}=await import('/src/engine/canvas-table-borders.js');
  const {pkg,images}=await openCanvasDocument(Uint8Array.from(bytes));
  const host=document.createElement('div');document.body.append(host);const editor=new CanvasEditor(host,{...pkg,images});
  try{
   const logical=JSON.stringify(editor.layout),samples=[];
   for(const scale of [2,4]){
    const canvas=document.createElement('canvas');canvas.width=816*scale;canvas.height=1056*scale;
    const ctx=canvas.getContext('2d');ctx.scale(scale,scale);
    for(const s of deviceTableBorders(ctx,editor.layout.tableBorders,true,editor.layout.pages[0]))if(!s.guide)paintTableBorder(ctx,s);
    for(const s of editor.layout.tableBorders.filter(s=>!s.guide)){
     const x=s.horizontal?Math.round((s.x+s.width/2)*scale):Math.floor(s.x*scale)-3;
     const y=s.horizontal?Math.floor(s.y*scale)-3:Math.round((s.y+s.height/2)*scale);
     const width=s.horizontal?1:Math.ceil(s.width*scale)+7,height=s.horizontal?Math.ceil(s.height*scale)+7:1;
     const data=ctx.getImageData(x,y,width,height).data;let coverage=0;
     for(let i=3;i<data.length;i+=4)coverage+=data[i]/255;
     samples.push({size:s.border.size,side:s.side,scale,widthPt:coverage*.75/scale});
    }
   }
   editor.setZoom(2);const screen=editor.canvases.map(c=>c.toDataURL());
   const first=editor.printSheets().map(c=>c.toDataURL());editor.paint();
   const screenUnchanged=JSON.stringify(screen)===JSON.stringify(editor.canvases.map(c=>c.toDataURL()));
   editor.setZoom(1);const second=editor.printSheets().map(c=>c.toDataURL());
   return {samples,sourceUnchanged:logical===JSON.stringify(editor.layout),screenUnchanged,printSame:JSON.stringify(first)===JSON.stringify(second)};
  }finally{editor.destroy();host.remove();}
 },[...source]);
 await info.attach('sixteen-native-pen-widths',{body:JSON.stringify(result,null,2),contentType:'application/json'});
 expect(result.sourceUnchanged).toBe(true);expect(result.screenUnchanged).toBe(true);expect(result.printSame).toBe(true);
 expect(result.samples).toHaveLength(128);
 for(const sample of result.samples){
  const reference=native.frames.find(f=>f.sizeEighthPoints===sample.size);
  expect(reference).toBeDefined();
  const width=['top','bottom'].includes(sample.side)?reference.horizontalWidthsPt[sample.side==='top'?0:1]:reference.verticalWidthsPt[sample.side==='left'?0:1];
  expect(Math.abs(sample.widthPt-width),`${sample.size}/8pt ${sample.side} at ${sample.scale}x`).toBeLessThan(.01);
 }
});
