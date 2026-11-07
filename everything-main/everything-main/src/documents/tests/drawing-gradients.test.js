import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
import { linearGradientAxis, readLinearGradient, canvasLinearGradient } from '../src/engine/drawing-gradients.js';
const folder='tests/fixtures/shape-gradients';
const cases=JSON.parse(readFileSync(`${folder}/cases.json`));
const reference=JSON.parse(readFileSync(`${folder}/reference.json`));
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
for(const [i,c] of cases.entries())it(`matches the native reference axis ${c.name}`,()=>{
  const expected=[...reference.cases[i].start,...reference.cases[i].end];
  linearGradientAxis(c.width,c.height,c.angle,c.scaled).forEach((v,j)=>expect(Math.abs(v-expected[j])).toBeLessThan(.011));
});
it('retains every gradient through an unrelated edit, reopen and exact undo',async()=>{
  const bytes=readFileSync(`${folder}/control.docx`),pkg=await DocxPackage.open(bytes);
  const fills=Object.values(pkg.assets).map(a=>a.scene.fill);
  expect(fills).toHaveLength(12);expect(fills.every(f=>f.type==='linearGradient'&&f.stops.length===3)).toBe(true);
  const doc=new TextDocument(pkg.paragraphs,pkg.pageSettings,pkg.numbering,pkg.styles,pkg.tables,pkg.assets);
  const save=async()=>new Uint8Array(await pkg.export(doc.paragraphs,doc.pageSettings,doc.numbering,doc.styles,doc.tables,doc.assets).arrayBuffer());
  doc.select(0);doc.replace('Edited ');const edited=await save();
  const reopened=await DocxPackage.open(edited);expect(Object.values(reopened.assets).map(a=>a.scene.fill)).toEqual(fills);
  for(const [name,data] of Object.entries(pkg.parts))if(name!=='word/document.xml')expect(unzipSync(edited)[name]).toEqual(data);
  doc.undo();expect(unzipSync(await save())).toEqual(unzipSync(bytes));
});
const xml=body=>new DOMParser().parseFromString(`<a:gradFill xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${body}</a:gradFill>`,'application/xml').documentElement;
const stops='<a:gsLst><a:gs pos="0"><a:srgbClr val="FF0000"/></a:gs><a:gs pos="100000"><a:srgbClr val="0000FF"/></a:gs></a:gsLst>';
it('does not create a nonfinite gradient for flat geometry',()=>{
 expect(canvasLinearGradient(null,{scaled:true},0,30)).toBe('rgba(0,0,0,0)');
 expect(canvasLinearGradient(null,{scaled:true},30,0)).toBe('rgba(0,0,0,0)');
});
it.each(['<a:lin ang="21600000"/>','<a:lin ang="-1"/>','<a:lin scaled="maybe"/>','<a:path path="rect"/>','<a:lin/><a:tileRect l="50000"/>','<a:lin/><a:lin/>'])('rejects unsupported or malformed gradient %s',tail=>expect(()=>readLinearGradient(xml(stops+tail))).toThrow());
it('accepts percentage stops with transformed color alpha',()=>{
 const fill=readLinearGradient(xml('<a:gsLst><a:gs pos="0%"><a:srgbClr val="FF0000"><a:alpha val="50000"/></a:srgbClr></a:gs><a:gs pos="100%"><a:srgbClr val="0000FF"/></a:gs></a:gsLst><a:lin/>'));
 expect(fill.stops).toEqual([{position:0,color:'rgba(255,0,0,0.5)'},{position:1,color:'#0000FF'}]);
});
it('sorts unordered positions stably without rewriting the source stop list',()=>{
 const node=xml('<a:gsLst><a:gs pos="100000"><a:srgbClr val="FFFF00"/></a:gs><a:gs pos="50%"><a:srgbClr val="00FF00"/></a:gs><a:gs pos="0"><a:srgbClr val="FF0000"/></a:gs><a:gs pos="50000"><a:srgbClr val="0000FF"/></a:gs></a:gsLst><a:lin/>');
 const before=new XMLSerializer().serializeToString(node),fill=readLinearGradient(node);
 expect(fill.stops).toEqual([{position:0,color:'#FF0000'},{position:.5,color:'#00FF00'},{position:.5,color:'#0000FF'},{position:1,color:'#FFFF00'}]);
 expect(new XMLSerializer().serializeToString(node)).toBe(before);
});
it('paints native reference duplicate-position colors without discarding parsed stops',()=>{
 const stops=[{position:0,color:'yellow'},{position:0,color:'red'},{position:.5,color:'green'},{position:.5,color:'blue'},{position:1,color:'yellow'},{position:1,color:'purple'}];
 const before=structuredClone(stops),calls=[];
 const paint={addColorStop:(...args)=>calls.push(args)};
 expect(canvasLinearGradient({createLinearGradient:()=>paint},{angle:0,scaled:false,stops},210,65)).toBe(paint);
 expect(calls).toEqual([[0,'red'],[.5,'green'],[1,'yellow']]);
 expect(stops).toEqual(before);
});
