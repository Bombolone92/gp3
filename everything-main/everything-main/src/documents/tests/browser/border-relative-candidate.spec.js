import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {coupledRoute,baselineRoute} from '../../tools/border-relative-experiment.mjs';
const black=rgb=>Math.max(...rgb)<128;
const red=([r,g,b])=>.299*r+.587*g+.114*b<166&&r>128&&r>g+32&&r>b+32;
for(const entry of [
 {name:'control',x:200,y:185,native:'native-100.png',predicate:black},
 {name:'filled',x:201,y:56,native:'native-filled-100.png',predicate:red},
])test(`relative border candidate regresses a formerly correct ${entry.name} corner pixel`,async({browser})=>{
 const values=[];
 for(const mode of ['baseline','candidate']){
  const context=await browser.newContext({deviceScaleFactor:1});
  try{
   if(mode==='candidate')await coupledRoute(context);
   else await baselineRoute(context);
   const page=await context.newPage();await page.goto('/playground.html');
   values.push(await page.evaluate(async({bytes,x,y,native})=>{
    const {openCanvasDocument}=await import('/src/engine/open-document.js');
    const {CanvasEditor}=await import('/src/engine/canvas-editor.js');
    const {pkg,images}=await openCanvasDocument(new Uint8Array(bytes));
    const host=document.createElement('div');document.body.append(host);
    const errors=[],editor=new CanvasEditor(host,{...pkg,images,onError:e=>errors.push(e.message)});
    try{
     editor.setZoom(1);editor.paint();
     const actual=[...editor.canvases[0].getContext('2d').getImageData(x,y,1,1).data].slice(0,3);
     const image=new Image();image.src='/tests/fixtures/border-phase/'+native;await image.decode();
     const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
     const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);
     return {actual,native:[...ctx.getImageData(x,y,1,1).data].slice(0,3),readOnly:!!pkg.readOnly,errors};
    }finally{editor.destroy();host.remove();}
   },{bytes:[...readFileSync(`tests/fixtures/border-phase/${entry.name}.docx`)],...entry,predicate:undefined}));
  }finally{await context.close();}
 }
 for(const value of values){expect(value.errors).toEqual([]);expect(value.readOnly).toBe(false);}
 expect(entry.predicate(values[0].native)).toBe(false);
 expect(entry.predicate(values[0].actual)).toBe(false);
 expect(entry.predicate(values[1].actual)).toBe(true);
});
