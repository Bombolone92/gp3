import {it,expect,beforeAll,afterAll} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {prepareShapeAutofit} from '../src/engine/shape-autofit.js';
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
const folder='tests/fixtures/shape-autofit-recovery/';
const measure=(text,style)=>({width:text.length*style.fontSize*.6,ascent:style.fontSize,descent:style.fontSize*.2});
it('retains only page-field frame sizes while fitting healthy siblings and preserving source',async()=>{
 const bytes=readFileSync(folder+'unsupported.docx'),pkg=await DocxPackage.open(bytes);
 const original=JSON.stringify(pkg.assets);
 expect(()=>prepareShapeAutofit(pkg.assets,measure)).toThrow(/page-dependent fields/);
 const result=prepareShapeAutofit(pkg.assets,measure,{bestEffort:true});
 expect(result.autofitApproximations).toHaveLength(3);
 expect(new Set(result.autofitApproximations.map(a=>a.message)).size).toBe(3);
 expect(JSON.stringify(pkg.assets)).toBe(original);
 const visit=(node,out=[])=>{if(node.text)out.push(node);for(const c of node.children||[])visit(c,out);return out;};
 let retained=0,fitted=0,grown=0;
 for(const [id,a]of Object.entries(pkg.assets)){
  if(!a.scene)continue;
  const before=visit(a.scene),after=visit(result.assets[id].scene);
  for(let i=0;i<before.length;i++){
   if(before[i].text.paragraphs.some(p=>p.runs.some(r=>r.field))){expect(after[i]).toBe(before[i]);retained++;}
   else{expect(after[i].height).not.toBe(before[i].height);if(after[i].height>before[i].height)grown++;fitted++;}
  }
 }
 expect(retained).toBe(3);expect(fitted).toBe(3);expect(grown).toBe(2);
 expect(unzipSync(new Uint8Array(await pkg.export().arrayBuffer()))).toEqual(unzipSync(bytes));
 const control=await DocxPackage.open(readFileSync(folder+'matched.docx'));
 const reference=prepareShapeAutofit(control.assets,measure);
 // noAutofit assets need no layout override, but all authored occurrences must
 // resolve to the same final frame dimensions under the stated approximation.
 for(const [id,a]of Object.entries(result.assets)){
  expect(a.width).toBe(reference.assets[id].width);expect(a.height).toBe(reference.assets[id].height);
 }
});
it('does not swallow unrelated text measurement failures in best-effort mode',async()=>{
 const pkg=await DocxPackage.open(readFileSync(folder+'matched.docx'));
 expect(()=>prepareShapeAutofit(pkg.assets,()=>{throw Error('measurement failed');},{bestEffort:true})).toThrow('measurement failed');
});
