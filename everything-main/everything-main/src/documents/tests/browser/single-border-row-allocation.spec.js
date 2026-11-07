import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';

test('native single-border flow remains stable in the editor at different zoom levels',async({page})=>{
 const folder='tests/fixtures/print-border-phase/';
 const reference=JSON.parse(readFileSync(folder+'native-metafile-rectangles.json'));
 const blue=reference.pages[0].fills.filter(f=>f.colorRef===0x917f6d);
 const native=Array.from({length:16},(_,i)=>{
  const r=blue.slice(i*12,(i+1)*12).map(f=>f.destination);
  return [Math.min(...r.map(v=>v[1])),Math.max(...r.map(v=>v[1]+v[3]))];
 });
 await page.goto('/playground.html');
 const result=await page.evaluate(async bytes=>{
  const {openCanvasDocument}=await import('/src/engine/open-document.js');
  const {CanvasEditor}=await import('/src/engine/canvas-editor.js');
  const {pkg,images}=await openCanvasDocument(Uint8Array.from(bytes));
  const host=document.createElement('div');document.body.append(host);
  const editor=new CanvasEditor(host,{...pkg,images});
  try{
   const before=JSON.stringify(editor.layout.tableBorders),bounds=[];
   for(const zoom of [1,1.25,2]){
    editor.setZoom(zoom);
    const groups=new Map();
    for(const s of editor.layout.tableBorders)if(!s.guide&&s.horizontal){
     if(!groups.has(s.tableId))groups.set(s.tableId,[]);
     groups.get(s.tableId).push(s);
    }
    bounds.push([...groups.values()].map(strokes=>[Math.min(...strokes.map(s=>s.y)),Math.max(...strokes.map(s=>s.y+s.height))].map(v=>Math.round(v*.75/.12+1e-5))));
   }
   return {bounds,unchanged:before===JSON.stringify(editor.layout.tableBorders),readOnly:!!pkg.readOnly,pages:editor.layout.pages.length};
  }finally{editor.destroy();host.remove();}
 },[...readFileSync(folder+'control.docx')]);
 expect(result.readOnly).toBe(false);expect(result.pages).toBe(1);expect(result.unchanged).toBe(true);
 for(const bounds of result.bounds)expect(bounds).toEqual(native);
});
