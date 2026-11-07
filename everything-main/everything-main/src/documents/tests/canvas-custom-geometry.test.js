import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
const source=readFileSync('public/fixtures/custom-geometry-guides.docx');
const A='http://schemas.openxmlformats.org/drawingml/2006/main';
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
const model=p=>new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
const save=async(p,d)=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
function changed(change){const parts=unzipSync(source),xml=new DOMParser().parseFromString(strFromU8(parts['word/document.xml']),'application/xml');change(xml);parts['word/document.xml']=strToU8(new XMLSerializer().serializeToString(xml));return zipSync(parts);}
const find=(xml,name)=>xml.getElementsByTagNameNS(A,name)[0];
it('resolves guides in each path grid and text rectangles in shape coordinates',async()=>{
 const p=await DocxPackage.open(source),scenes=Object.values(p.assets).map(a=>a.scene);
 expect(scenes).toHaveLength(20);
 expect(scenes[5].paths[0].points[1]).toEqual(['L',23,0]); // The native reference rounds 22.5 path units.
 expect(scenes[17].paths[0].points[1]).toEqual(['L',68,0]);
 expect(scenes[18].paths[0].points[1]).toEqual(['L',1428750,0]); // Intermediate 62.5 remains fractional.
 expect(scenes[19].textRect).toEqual({left:.25,top:0,right:.75,bottom:1});
 const explicit=await DocxPackage.open(changed(xml=>{for(const name of ['headEnd','tailEnd'])for(const n of xml.getElementsByTagNameNS(A,name))n.setAttribute('type','none');}));
 expect(Object.values(explicit.assets).map(a=>a.scene.paths)).toEqual(scenes.map(s=>s.paths));
});
it.each(['custom-geometry-guides','geometry-guide-rebinding','empty-drawing-paths'])('preserves %s XML through edit/reopen and undo',async fixture=>{
 const source=readFileSync(`public/fixtures/${fixture}.docx`);
 const p=await DocxPackage.open(source),d=model(p),original=unzipSync(source);
 d.select(0);d.replace('Edited ');const bytes=await save(p,d),reopened=await DocxPackage.open(bytes);
 expect(model(reopened).text).toBe(d.text);
 const exported=unzipSync(bytes);
 for(const name of Object.keys(original))if(name!=='word/document.xml')expect(Buffer.from(exported[name]).equals(Buffer.from(original[name])),name).toBe(true);
 const drawingTrees=bytes=>{const xml=new DOMParser().parseFromString(strFromU8(unzipSync(bytes)['word/document.xml']),'application/xml');return [...xml.getElementsByTagNameNS(A,'custGeom')].map(n=>[...n.querySelectorAll('*')].map(x=>[x.localName,[...x.attributes].map(a=>[a.name,a.value])]));};
 expect(drawingTrees(bytes)).toEqual(drawingTrees(source));d.undo();const undone=unzipSync(await save(p,d));
 for(const name of Object.keys(original))expect(Buffer.from(undone[name]).equals(Buffer.from(original[name])),name).toBe(true);
});
it('matches the native reference rounding of negative half-unit path coordinates away from zero',async()=>{
 const p=await DocxPackage.open(readFileSync('public/fixtures/custom-geometry-negative.docx'));
 expect(Object.values(p.assets).slice(0,4).map(a=>a.scene.paths[0].points[0][1])).toEqual([-1,-2,-3,-4]);
});
it('accepts empty paths while retaining visible paths and nested groups',async()=>{
 const p=await DocxPackage.open(readFileSync('public/fixtures/empty-drawing-paths.docx'));
 const scenes=Object.values(p.assets).map(a=>a.scene);
 expect(scenes).toHaveLength(6);
 for(const s of scenes.slice(0,3))expect(s.paths[0].points).toEqual([]);
 expect(scenes[3].paths.map(p=>p.points.length)).toEqual([0,5]);
 expect(scenes[4].paths.map(p=>p.points.length)).toEqual([5,0]);
 expect(scenes[5].children[0].children[0].paths.map(p=>p.points.length)).toEqual([0,5]);
});
it('still rejects a nonempty path without an initial move',async()=>{
 await expect(DocxPackage.open(changed(xml=>find(xml,'moveTo').remove())))
  .rejects.toThrow(/paths without an initial move/);
});
it.each([
 ['forward guide',xml=>find(xml,'gd').setAttribute('fmla','val end')],
 ['unknown connection guide',xml=>find(xml,'pos').setAttribute('x','missing')],
 ['unknown text guide',xml=>find(xml,'rect').setAttribute('l','missing')],
 ['unknown path guide',xml=>find(xml,'pt').setAttribute('y','missing')],
 ['missing connection position',xml=>find(xml,'pos').remove()],
 ['duplicate connection position',xml=>{const n=find(xml,'pos');n.parentElement.append(n.cloneNode(true));}],
])('guards %s without enabling editing',async(_,change)=>{
 await expect(DocxPackage.open(changed(change))).rejects.toMatchObject({name:'UnsupportedDocumentError'});
});
// Arrowheads of every type open for editing (docs/conformance.md, Arrowheads), custom paths included.
it('opens a custom path with a visible arrow for editing and keeps the arrow',async()=>{
 const p=await DocxPackage.open(changed(xml=>find(xml,'headEnd').setAttribute('type','triangle')));
 expect(p.readOnly).toBeFalsy();
 expect(Object.values(p.assets).map(a=>a.scene?.outline?.headEnd?.type)).toContain('triangle');
});
