import {chromium} from '@playwright/test';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
const out=process.argv[2];if(!out)throw Error('Usage: node tools/diagnose-border-phase.mjs <output-directory> [source.docx] [comma-separated zooms]');
const zooms=(process.argv[4] || '1,2').split(',').map(Number);
if(!zooms.length || zooms.some(z=>!Number.isFinite(z)||z<.1||z>5))throw Error('Choose zoom factors from 0.1 to 5.');
mkdirSync(out,{recursive:true});const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage({deviceScaleFactor:1});
 await page.goto('http://127.0.0.1:5173/playground.html',{timeout:120000});
 const results=await page.evaluate(async ({bytes,zooms})=>{
  const {openCanvasDocument}=await import('/src/engine/open-document.js');
  const {CanvasEditor}=await import('/src/engine/canvas-editor.js');
  const {deviceTableBorders}=await import('/src/engine/border-device-layout.js');
  const {pkg,images}=await openCanvasDocument(new Uint8Array(bytes));
  const host=document.createElement('div');document.body.append(host);const errors=[];
  const editor=new CanvasEditor(host,{...pkg,images,onError:e=>errors.push(e.message)}),out=[];
  try{for(const zoom of zooms){
   editor.setZoom(zoom);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
   const canvas=editor.canvases[0],ctx=new OffscreenCanvas(1,1).getContext('2d');ctx.scale(zoom,zoom);
   out.push({zoom,readOnly:!!pkg.readOnly,pages:editor.canvases.length,issues:pkg.previewIssues,errors:[...errors],png:canvas.toDataURL(),
    cells:editor.layout.cells.map(({tableId,x,y,width,height,fill})=>({tableId,x,y,width,height,fill})),
    logical:editor.layout.tableBorders.filter(s=>!s.guide),device:deviceTableBorders(ctx,editor.layout.tableBorders).filter(s=>!s.guide)});
  }}finally{editor.destroy();host.remove();}return out;
 },{bytes:[...readFileSync(process.argv[3] || 'tests/fixtures/border-phase/control.docx')],zooms});
 for(const r of results){writeFileSync(join(out,`app-${r.zoom*100}.png`),Buffer.from(r.png.split(',')[1],'base64'));delete r.png;}
 writeFileSync(join(out,'results.json'),JSON.stringify(results,null,2)+'\n');
 console.log(JSON.stringify(results.map(({zoom,pages,readOnly,errors})=>({zoom,pages,readOnly,errors}))));
}finally{await browser.close();}
