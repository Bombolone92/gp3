import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
import { bezierExtrema } from '../src/engine/bezier-bounds.js';
const source=readFileSync('public/fixtures/bezier-paths.docx'), A='http://schemas.openxmlformats.org/drawingml/2006/main';
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
const model=p=>new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
const save=async(p,d)=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
it('finds true curve extrema, including reduced-degree and constant curves',()=>{
 expect(bezierExtrema([0,100,0])).toEqual([50]);expect(bezierExtrema([0,100,100,0])).toEqual([75]);
 expect(bezierExtrema([0,0,0,0])).toEqual([]);expect(bezierExtrema([0,33,66,99])).toEqual([]);
 const s=bezierExtrema([0,100,-100,0]).sort((a,b)=>a-b);expect(s).toHaveLength(2);expect(s[0]).toBeCloseTo(-28.867513459);expect(s[1]).toBeCloseTo(28.867513459);
 expect(bezierExtrema([0,0,100])).toEqual([]);
});
it('reads both Bézier degrees and retains guide resolution and nested transforms',async()=>{
 const p=await DocxPackage.open(source),scenes=Object.values(p.assets).map(a=>a.scene);
 expect(scenes).toHaveLength(6);expect(scenes[0].paths[0].points[1]).toEqual(['C',0,-20,100,-20,100,50]);
 expect(scenes[1].paths[0].points[1]).toEqual(['Q',50,-75,100,75]);
 expect(scenes[5].children[0].children[0].paths[0].points[1]).toEqual(['C',0,-20,100,-20,100,50]);
});
it('retains all curve XML through editing, atomic deletion, export/reopen and complete undo',async()=>{
 const p=await DocxPackage.open(source),d=model(p);d.select(0);d.replace('Edited ');
 const at=d.text.indexOf('\ufffc');d.select(at,at+1);expect(()=>d.setImageProperties({width:100})).toThrow(/complete objects/);d.replace('');d.undo();
 const bytes=await save(p,d),reopened=await DocxPackage.open(bytes);expect(model(reopened).text).toBe(d.text);
 expect(Object.values(reopened.assets).map(a=>a.scene)).toEqual(Object.values(p.assets).map(a=>a.scene));
 while(d.history.length)d.undo();const out=unzipSync(await save(p,d));for(const [name,data] of Object.entries(p.parts))expect(Buffer.from(out[name]).equals(Buffer.from(data)),name).toBe(true);
});
it.each(['missing-point','extra-point','missing-coordinate','wrong-namespace','nested-point','unknown-guide'])('rejects malformed curves: %s',async kind=>{
 for(const tag of ['cubicBezTo','quadBezTo']){
  const parts=unzipSync(source),xml=new DOMParser().parseFromString(strFromU8(parts['word/document.xml']),'application/xml'),curve=xml.getElementsByTagNameNS(A,tag)[0],pt=curve.firstElementChild;
  if(kind==='missing-point')pt.remove();if(kind==='extra-point')curve.append(pt.cloneNode(true));if(kind==='missing-coordinate')pt.removeAttribute('x');
  if(kind==='wrong-namespace')pt.replaceWith(xml.createElementNS('urn:future','future:pt'));if(kind==='nested-point')pt.append(xml.createElementNS(A,'a:pt'));if(kind==='unknown-guide')pt.setAttribute('x','missing');
  parts['word/document.xml']=strToU8(new XMLSerializer().serializeToString(xml));await expect(DocxPackage.open(zipSync(parts))).rejects.toMatchObject({name:'UnsupportedDocumentError'});
 }
});

it('matches the native reference suppression of continuations after close, but supports a new subpath',async()=>{
 const p=await DocxPackage.open(readFileSync('public/fixtures/bezier-close-paths.docx'));
 const paths=Object.values(p.assets).map(a=>a.scene.type==='group'?a.scene.children[0].children[0].paths[0]:a.scene.paths[0]);
 for(const index of [0,1,2,4,5])expect(paths[index].points).toEqual([]);
 expect(paths[3].points.map(op=>op[0])).toEqual(['M','L','L','Z','M','Q','Z']);
});
