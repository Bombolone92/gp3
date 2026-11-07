import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { openReadOnlyPreview } from './helpers/preview.js';
const folder='tests/fixtures/unequal-table-recovery/';
test('unequal-column recovery retains rich pixels and original-byte download',async({page},info)=>{
 test.setTimeout(180000);
 await page.goto('/playground.html',{waitUntil:'domcontentloaded'});
 await page.getByRole('textbox',{name:'Document text'}).waitFor({state:'attached'});
 const inputs=Object.fromEntries(['first','second','split'].flatMap(v=>['equal-','unequal-'].map(prefix=>{const n=prefix+v;return [n,readFileSync(`${folder}${n}.docx`).toString('base64')];})));
 const results=await page.evaluate(async inputs=>{
  const {openCanvasDocument}=await import('/src/engine/open-document.js');
  const {CanvasEditor}=await import('/src/engine/canvas-editor.js');
  const rendered={};
  for(const [name,b64] of Object.entries(inputs)){
   const {pkg,images}=await openCanvasDocument(Uint8Array.from(atob(b64),c=>c.charCodeAt(0)));
   const host=document.createElement('div');document.body.append(host);const errors=[];
   const editor=new CanvasEditor(host,{...pkg,images,onError:e=>errors.push(e.message)});
   let exportBlocked=false;try{pkg.export();}catch{exportBlocked=true;}
   rendered[name]={readOnly:!!pkg.readOnly,tables:pkg.tables.length,images:images.size,issues:pkg.previewIssues||[],errors,exportBlocked,
    cells:editor.layout.cells.length,pages:editor.canvases.length,pixels:editor.canvases.map(c=>c.toDataURL())};
   editor.destroy();host.remove();
  }
  return ['first','second','split'].map(v=>{const a=rendered['unequal-'+v],c=rendered['equal-'+v];return {...a,pixels:undefined,name:v,samePixels:JSON.stringify(a.pixels)===JSON.stringify(c.pixels),controlEditable:!c.readOnly};});
 },inputs);
 for(const r of results){
  expect(r.readOnly).toBe(true);expect(r.controlEditable).toBe(true);expect(r.exportBlocked).toBe(true);
  expect(r.errors).toEqual([]);expect(r.tables).toBe(1);expect(r.images).toBe(2);
  expect(r.cells).toBe(r.name==='split'?90:1);expect(r.samePixels).toBe(true);
  expect(r.issues.some(m=>m.includes("first column's width"))).toBe(true);
 }
 await openReadOnlyPreview(page,`${folder}unequal-second.docx`);
 await page.locator('summary').filter({hasText:'Unsupported features detected'}).click();
 await expect(page.getByText(/Section 1, table 1: table layout in unequal-width/)).toBeVisible();
 await page.locator('canvas.canvas-page').first().screenshot({path:info.outputPath('unequal-table-recovery.png')});
});
