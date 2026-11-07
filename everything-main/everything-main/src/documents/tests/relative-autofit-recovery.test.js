import {it,expect,beforeAll,afterAll} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {prepareShapeAutofit} from '../src/engine/shape-autofit.js';
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
const folder='tests/fixtures/relative-autofit-recovery/';
const measure=(text,style)=>({width:text.length*style.fontSize*.6,ascent:style.fontSize,descent:style.fontSize*.2});
it.each(['','grouped-'])('retains %srelative scenes while independently fitting healthy drawings',async(prefix)=>{
 const bytes=readFileSync(folder+prefix+'unsupported.docx'),pkg=await DocxPackage.open(bytes);
 const original=JSON.stringify(pkg.assets);
 expect(()=>prepareShapeAutofit(pkg.assets,measure)).toThrow(/relative page sizing/);
 expect(JSON.stringify(pkg.assets)).toBe(original);
 const actual=prepareShapeAutofit(pkg.assets,measure,{bestEffort:true});
 const control=await DocxPackage.open(readFileSync(folder+prefix+'matched.docx'));
 const expected=prepareShapeAutofit(control.assets,measure);
 expect(actual.autofitApproximations).toHaveLength(3);
 expect(new Set(actual.autofitApproximations.map(a=>a.message)).size).toBe(3);
 let retained=0,fitted=0;
 for(const [id,a]of Object.entries(pkg.assets)){
  if(a.relativeFrame){expect(actual.assets[id]).toBe(a);expect(actual.drawingLayouts.has(id)).toBe(false);retained++;}
  else{expect(actual.assets[id].height).not.toBe(a.height);fitted++;}
  expect(actual.assets[id].width).toBe(expected.assets[id].width);
  expect(actual.assets[id].height).toBe(expected.assets[id].height);
 }
 expect(retained).toBe(3);expect(fitted).toBe(1);
 expect(JSON.stringify(pkg.assets)).toBe(original);
 const again=prepareShapeAutofit(actual.assets,measure,{bestEffort:true});
 expect(again.assets).toBe(actual.assets);
 expect(again.autofitApproximations).toEqual(actual.autofitApproximations);
 expect(unzipSync(new Uint8Array(await pkg.export().arrayBuffer()))).toEqual(unzipSync(bytes));
});
