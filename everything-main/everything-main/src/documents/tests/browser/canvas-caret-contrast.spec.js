import {test, expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
test.setTimeout(180000);

test('insertion caret remains distinct from artwork-colored backdrops and respects physical clipping',async({page})=>{
 await page.goto('/playground.html');
 const result=await page.evaluate(async()=>{
  const {paintInsertionCaret}=await import('/src/engine/canvas-caret.js');
  const rows=[];
  for(const scale of [1,2,4])for(const background of ['#375f91','#0A3556','#000000','#FFFFFF','#808080'])for(const horizontal of [false,true]){
   const canvas=document.createElement('canvas');canvas.width=120*scale;canvas.height=80*scale;
   const ctx=canvas.getContext('2d');ctx.scale(scale,scale);ctx.fillStyle=background;ctx.fillRect(0,0,120,80);
   const caret={x:30,y:20,width:horizontal?30:2,height:horizontal?2:30};
   // Rendering the overlay must not require synchronous canvas pixel readback.
   const read=ctx.getImageData.bind(ctx);ctx.getImageData=()=>{throw Error('caret readback');};
   paintInsertionCaret(ctx,caret,scale,{left:0,top:0,right:120,bottom:80});ctx.getImageData=read;
   const color=(x,y)=>Array.from(read(x,y,1,1).data).slice(0,3);
   rows.push({core:color(31*scale,21*scale),edge:color(30*scale-1,20*scale),outside:color(30*scale-2,20*scale),background});
   ctx.fillStyle=background;ctx.fillRect(0,0,120,80);
   paintInsertionCaret(ctx,caret,scale,{left:30,top:20,right:32,bottom:22});
   rows.at(-1).clippedOutside=color(30*scale-1,20*scale);
   ctx.fillStyle=background;ctx.fillRect(0,0,120,80);const before=canvas.toDataURL();
   paintInsertionCaret(ctx,{...caret,height:0},scale);rows.at(-1).hiddenUnchanged=before===canvas.toDataURL();
  }
  return rows;
 });
 for(const row of result){
  expect(row.core).toEqual([55,95,145]);expect(row.edge).toEqual([255,255,255]);
  const rgb=row.background.slice(1).match(/../g).map(n=>parseInt(n,16));
  expect(row.outside).toEqual(rgb);expect(row.clippedOutside).toEqual(rgb);expect(row.hiddenUnchanged).toBe(true);
 }
});

test('native page/shading controls retain content, print pixels and geometry while the focused caret gains contrast',async({page},info)=>{
 await page.goto('/playground.html');
 const result=await page.evaluate(async bytes=>{
  const {openCanvasDocument}=await import('/src/engine/open-document.js');
  const {CanvasEditor}=await import('/src/engine/canvas-editor.js');
  const {caretRect}=await import('/src/engine/layout.js');
  const {pkg,images}=await openCanvasDocument(new Uint8Array(bytes));
  const host=document.createElement('div');document.body.append(host);const editor=new CanvasEditor(host,{...pkg,images});
  try{
   const original=editor.model.text,geometry=JSON.stringify(editor.layout.lines),printed=editor.printSheets().map(c=>c.toDataURL());
   const rows=[];
   for(const zoom of [.75,1,2])for(const label of ['PAGE AUTO','PARAGRAPH WHITE','PARAGRAPH DARK','HIGHLIGHT YELLOW','HIGHLIGHT BLACK','RUN WHITE','RUN DARK','CELL AUTO','CELL WHITE']){
    editor.setZoom(zoom);editor.model.select(original.indexOf(label));editor.focus();editor.paint();
    const caret=caretRect(editor.selectionLayout,editor.model.selection.focus),canvas=editor.canvases[caret.page],scale=canvas.width/editor.layout.pages[caret.page].width;
    const focused=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
    editor.input.blur();editor.paint();const unfocused=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
    let changes=0,outside=0,lightSurround=0;
    for(let i=0;i<focused.length;i+=4)if(focused[i]!==unfocused[i]||focused[i+1]!==unfocused[i+1]||focused[i+2]!==unfocused[i+2]){
     changes++;const x=(i/4)%canvas.width,y=Math.floor(i/4/canvas.width);
     if(x<Math.floor(caret.x*scale)-2||x>Math.ceil((caret.x+(caret.width??1.5))*scale)+2||y<Math.floor(caret.y*scale)-2||y>Math.ceil((caret.y+caret.height)*scale)+2)outside++;
     // Fractional caret origins blend the one-pixel surround across two pixels.
     if(Math.min(focused[i],focused[i+1],focused[i+2])>100&&focused[i]>unfocused[i]+20)lightSurround++;
    }
    rows.push({label,zoom,changes,outside,lightSurround});
   }
   editor.model.select(0);editor.execute(()=>editor.model.replace('Edited '));editor.undo();
   const saved=Array.from(new Uint8Array(await editor.export(pkg).arrayBuffer()));
   return {rows,sourceUnchanged:original===editor.model.text,geometryUnchanged:geometry===JSON.stringify(editor.layout.lines),printUnchanged:JSON.stringify(printed)===JSON.stringify(editor.printSheets().map(c=>c.toDataURL())),saved};
  }finally{editor.destroy();host.remove();}
 },Array.from(readFileSync('public/fixtures/page-background-dark.docx')));
 for(const row of result.rows){expect(row.changes,JSON.stringify(row)).toBeGreaterThan(0);expect(row.outside,JSON.stringify(row)).toBe(0);if(['PAGE AUTO','PARAGRAPH DARK','HIGHLIGHT BLACK','RUN DARK','CELL AUTO'].includes(row.label))expect(row.lightSurround,JSON.stringify(row)).toBeGreaterThan(0);}
 expect(result.sourceUnchanged).toBe(true);expect(result.geometryUnchanged).toBe(true);expect(result.printUnchanged).toBe(true);
 const {unzipSync}=await import('fflate');expect(unzipSync(new Uint8Array(result.saved))).toEqual(unzipSync(readFileSync('public/fixtures/page-background-dark.docx')));
 const {writeFileSync}=await import('node:fs');writeFileSync(info.outputPath('caret-undo.docx'),new Uint8Array(result.saved));
});
