import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {JSDOM} from 'jsdom';
import {unzipSync} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
const folder='tests/fixtures/border-phase/',ref=JSON.parse(readFileSync(folder+'reference.json'));
const hash=name=>createHash('sha256').update(readFileSync(folder+name)).digest('hex');
for(const name of ['heights-thin','heights-wide'])it(`binds ${name} native observations and preserves its exact-height package`,async()=>{
 const r=JSON.parse(readFileSync(folder+'native-height-reference.json')).controls.find(c=>c.source===name+'.docx');
 expect(hash(r.source)).toBe(r.sourceSha256);expect(hash(r.cases)).toBe(r.casesSha256);
 expect(r.physical).toHaveLength(16);expect(r.observations.map(o=>o.zoom)).toEqual([100,200]);
 for(const o of r.observations){expect(hash(o.crop)).toBe(o.cropSha256);expect(o.regions).toHaveLength(16);expect(o.comparisons).toHaveLength(16);}
 expect(r.frozen600DpiModel.matchingEdges).toEqual([32,32,32,28]);expect(r.frozen600DpiModel.counterexamples).toHaveLength(4);
 const dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;
 try{
  const bytes=readFileSync(folder+r.source),parts=unzipSync(bytes);
  const xml=new dom.window.DOMParser().parseFromString(new TextDecoder().decode(parts['word/document.xml']),'application/xml');
  const heights=Array.from(xml.getElementsByTagName('w:trHeight'),e=>[Number(e.getAttribute('w:val')),e.getAttribute('w:hRule')]);
  expect(heights).toEqual([473,479,481,487].flatMap(h=>Array.from({length:4},()=>[h,'exact'])));
  const p=await DocxPackage.open(bytes);expect(p.readOnly).not.toBe(true);expect(p.tables).toHaveLength(16);
  expect(unzipSync(new Uint8Array(await p.export().arrayBuffer()))).toEqual(parts);
 }finally{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;}
},60000);
it('binds paired shading controls and retains bottom-edge counterexamples',()=>{
 const r=JSON.parse(readFileSync(folder+'native-fill-reference.json'));
 expect(r.controls).toHaveLength(2);
 for(const c of r.controls){
  expect(hash(c.source)).toBe(c.sourceSha256);expect(hash(c.cases)).toBe(c.casesSha256);
  expect(c.physical).toHaveLength(16);expect(c.pdfSha256).toMatch(/^[a-f0-9]{64}$/);
  for(const o of c.observations){expect(hash(o.crop)).toBe(o.cropSha256);expect(o.regions).toHaveLength(16);expect(o.comparisons).toHaveLength(16);}
 }
 const m=r.rejected600DpiFrameModel;
 for(const [name,sha] of Object.entries(m.referenceHashes))expect(hash(name)).toBe(sha);
 expect(m.frames).toBe(128);expect(m.matchingEdges.slice(0,3)).toEqual([128,128,128]);
 expect(m.counterexamples).toHaveLength(15);expect(m.matchingEdges[3]).toBe(113);
});
for(const name of ['filled','borderless'])it(`preserves the ${name} independent shading package`,async()=>{
 const dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;
 try{
  const bytes=readFileSync(folder+name+'.docx'),p=await DocxPackage.open(bytes);
  expect(p.readOnly).not.toBe(true);expect(p.tables).toHaveLength(16);
  expect(p.tables.every(t=>t.rows[0].cells[0].fill==='#FF0000')).toBe(true);
  expect(unzipSync(new Uint8Array(await p.export().arrayBuffer()))).toEqual(unzipSync(bytes));
 }finally{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;}
},60000);
it('binds intermediate zoom captures and retains counterexamples to center rounding',()=>{
 const r=JSON.parse(readFileSync(folder+'native-intermediate-reference.json'));
 expect(hash('control.docx')).toBe(r.sourceSha256);expect(hash('cases.json')).toBe(r.casesSha256);
 expect(hash('reference.json')).toBe(r.originalReferenceSha256);
 expect(r.observations.map(o=>o.zoom)).toEqual([125,150]);
 for(const o of r.observations){expect(hash(o.crop)).toBe(o.cropSha256);expect(o.regions).toHaveLength(16);expect(o.comparisons).toHaveLength(16);}
 expect(r.rejectedCenterModels.map(m=>m.rounding)).toEqual(['floor','round','ceil']);
 for(const m of r.rejectedCenterModels){
  expect(m.checkedLeadingEdges).toBe(128);expect(m.counterexamples.length).toBeGreaterThan(0);
  for(const c of m.counterexamples){
   const o=[...ref.observations,...r.observations].find(o=>o.zoom===c.zoom);
   expect(c.native).toBe(o.comparisons.find(v=>v.id===c.id).native[c.axis]);expect(c.predicted).not.toBe(c.native);
  }
 }
});
it('binds native coordinate probes and distinguishes reported positions from serialized geometry',()=>{
 const probe=JSON.parse(readFileSync(folder+'native-coordinate-reference.json'));
 expect(probe.controls).toHaveLength(2);
 for(const c of probe.controls){
  expect(hash(c.source)).toBe(c.sourceSha256);expect(hash(c.cases)).toBe(c.casesSha256);
  expect(c.normalizedDocxSha256).toMatch(/^[a-f0-9]{64}$/);
  const cases=JSON.parse(readFileSync(folder+c.cases));
  expect(c.authoredPositionsTwips).toEqual(cases.map(k=>[k.xTwips,k.yTwips]));
  expect(c.normalizedPositionsTwips).toEqual(c.authoredPositionsTwips);
  expect(c.observations.map(o=>o.zoom)).toEqual([75,100,125,150,200]);
  for(const o of c.observations){
   expect(o.tables).toHaveLength(16);
   expect(o.tables.map(t=>[t.x,t.y])).toEqual(c.observations[0].tables.map(t=>[t.x,t.y]));
   for(const [i,t] of o.tables.entries()){
    expect(t.horizontalPosition).toBeCloseTo(cases[i].xTwips/20-.05,4);
    expect(t.verticalPosition).toBeCloseTo(cases[i].yTwips/20-.05,4);
    expect(t.rowHeight).toBe(24);expect(t.cellWidth).toBe(48);
    expect(t.padding).toEqual([0,0,0,0]);expect(t.lineWidths).toEqual(Array(4).fill(cases[i].size));
   }
  }
 }
});
it('binds all native phase controls to the original source and captures',()=>{
 expect(hash('control.docx')).toBe(ref.sourceSha256);expect(hash('cases.json')).toBe(ref.casesSha256);expect(ref.pdfSha256).toMatch(/^[a-f0-9]{64}$/);
 expect(ref.physical).toHaveLength(16);expect(ref.observations).toHaveLength(2);
 for(const o of ref.observations){expect(hash(o.crop)).toBe(o.cropSha256);expect(o.regions).toHaveLength(16);expect(o.comparisons).toHaveLength(16);}
});
it('retains all sixteen authored floating tables and all source parts',async()=>{
 const dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;
 try{
  const bytes=readFileSync(folder+'control.docx'),p=await DocxPackage.open(bytes);
  expect(p.readOnly).not.toBe(true);expect(p.tables).toHaveLength(16);
  expect(unzipSync(new Uint8Array(await p.export().arrayBuffer()))).toEqual(unzipSync(bytes));
 }finally{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;}
},60000);
for(const name of ['holdout','reordered']){
 it(`binds ${name} native observations and preserves all package parts`,async()=>{
  const r=JSON.parse(readFileSync(folder+`native-${name}-reference.json`));
  expect(hash(name+'.docx')).toBe(r.sourceSha256);expect(hash(name+'-cases.json')).toBe(r.casesSha256);
  expect(r.observations).toHaveLength(2);
  for(const o of r.observations){
   expect(hash(o.crop)).toBe(o.cropSha256);expect(o.comparisons).toHaveLength(16);
   if(name==='reordered')expect(o.comparisons.map(c=>c.native)).toEqual(ref.observations.find(b=>b.zoom===o.zoom).comparisons.map(c=>c.native));
  }
  const dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;
  try{
   const bytes=readFileSync(folder+name+'.docx'),p=await DocxPackage.open(bytes);
   expect(p.readOnly).not.toBe(true);expect(p.tables).toHaveLength(16);
   expect(unzipSync(new Uint8Array(await p.export().arrayBuffer()))).toEqual(unzipSync(bytes));
   if(name==='reordered'){
    const xml=b=>new dom.window.DOMParser().parseFromString(new TextDecoder().decode(unzipSync(b)['word/document.xml']),'application/xml');
    const tables=b=>Array.from(xml(b).getElementsByTagName('w:tbl'),e=>e.outerHTML);
    expect(tables(bytes)).toEqual(tables(readFileSync(folder+'control.docx')).reverse());
   }
  }finally{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;}
 },60000);
}
