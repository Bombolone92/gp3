import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {unzipSync} from 'fflate';
const folder='tests/fixtures/border-position-getters/';
const ref=JSON.parse(readFileSync(folder+'reference.json'));
for(const source of ref.sources)test(`${source.name}: actual imports retain all authored positions and exact no-edit parts`,async({page})=>{
 await page.goto('/playground.html');const bytes=readFileSync(resolve(folder,source.source));
 const cases=JSON.parse(readFileSync(resolve(folder,source.cases)));
 const actual=await page.evaluate(async({bytes})=>{
  const {openCanvasDocument}=await import('/src/engine/open-document.js'),{CanvasEditor}=await import('/src/engine/canvas-editor.js');
  const {floatingTableX,floatingTableY}=await import('/src/engine/floating-tables.js');
  const {pkg,images}=await openCanvasDocument(new Uint8Array(bytes)),host=document.createElement('div');document.body.append(host);const errors=[];
  const editor=new CanvasEditor(host,{...pkg,images,onError:e=>errors.push(e.message)});
  try{editor.paint();return{positions:pkg.tables.map(t=>({x:t.floating.tblpX,y:t.floating.tblpY,
   layoutX:floatingTableX(t.floating,{compatibilityMode:15,width:384,left:0,right:0},64),
   layoutY:floatingTableY(t.floating,{height:288,top:0,bottom:0},8,{y:0})})),
   pages:editor.canvases.length,readOnly:!!pkg.readOnly,issues:pkg.previewIssues||[],errors,
   exported:[...new Uint8Array(await pkg.export().arrayBuffer())]};}finally{editor.destroy();host.remove();}
 },{bytes:[...bytes]});
 expect(actual.positions).toEqual(cases.map(c=>({x:c.xTwips,y:c.yTwips,layoutX:c.xTwips/15,layoutY:c.yTwips/15})));
 expect(actual.pages).toBe(source.name==='axis'?8:1);expect(actual.readOnly).toBe(false);expect(actual.issues).toEqual([]);expect(actual.errors).toEqual([]);
 expect(unzipSync(Uint8Array.from(actual.exported))).toEqual(unzipSync(bytes));
});
