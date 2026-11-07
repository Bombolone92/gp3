import { beforeAll, afterAll, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
import { pictureFillRect } from '../src/engine/picture-fills.js';
import { expectBodyEditParts } from './helpers/expect-body-edit-parts.js';
const A='http://schemas.openxmlformats.org/drawingml/2006/main',R='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>dom.window.close());
const source=readFileSync('public/fixtures/shape-picture-fills.docx');
const model=p=>new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
const save=async(p,d)=>unzipSync(new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer()));
const scenes=p=>p.paragraphs.flatMap(p=>p.runs.filter(r=>r.image).map(r=>r.image.assetId)).map(id=>p.assets[id].scene);
function equalParts(actual, expected) {
  expect(Object.keys(actual).sort()).toEqual(Object.keys(expected).sort());
  for (const key of Object.keys(expected)) expect(Buffer.from(actual[key]).equals(Buffer.from(expected[key])), key).toBe(true);
}
function changed(fn){const parts=unzipSync(source),doc=new DOMParser().parseFromString(strFromU8(parts['word/document.xml']),'application/xml');fn(doc,doc.getElementsByTagNameNS(A,'blipFill')[0]);parts['word/document.xml']=strToU8(new XMLSerializer().serializeToString(doc));return zipSync(parts);}

it('maps independent reference source/destination probes and shares their image resource',async()=>{
  const pkg=await DocxPackage.open(source),nodes=scenes(pkg);
  expect(nodes).toHaveLength(7);expect(Object.values(pkg.assets).filter(a=>a.bytes)).toHaveLength(1);
  const expected=[[0,0,288,216],[0,0,288,216],[57.6,0,230.4,216],[72,54,144,108],[-72,0,432,216],[0,54,216,108],[0,0,288,216]];
  nodes.forEach((n,i)=>pictureFillRect(n.fill,288,216,64,64).destination.forEach((v,j)=>expect(v).toBeCloseTo(expected[i][j])));
  expect(pictureFillRect(nodes[1].fill,288,216,64,64).source).toEqual([16,0,48,64]);
  expect(nodes[6].paths[0].points).toContainEqual(['L',90,100]);
});

it('retains all drawings and unrelated parts during editing/reopening and full undo',async()=>{
  const pkg=await DocxPackage.open(source),d=model(pkg);equalParts(await save(pkg,d),pkg.parts);
  d.select(0);d.replace('Edited ');const parts=await save(pkg,d),reopened=await DocxPackage.open(zipSync(parts));
  expect(scenes(reopened)).toEqual(scenes(pkg));
  expectBodyEditParts(parts,pkg.parts);
  d.undo();equalParts(await save(pkg,d),pkg.parts);
});

it('recognizes a direct picture fill overriding inactive theme fill references',async()=>{
  const bytes=changed((doc,fill)=>{
    const shape=fill.parentElement.parentElement,ns=shape.namespaceURI;
    const style=doc.createElementNS(ns,'wps:style');
    for(const [name,idx] of [['lnRef','2'],['fillRef','1'],['effectRef','0'],['fontRef','minor']]) {
      const r=doc.createElementNS(A,'a:'+name);r.setAttribute('idx',idx);const c=doc.createElementNS(A,'a:schemeClr');c.setAttribute('val','accent1');r.append(c);style.append(r);
    }
    shape.insertBefore(style,shape.lastElementChild);
  });
  expect(scenes(await DocxPackage.open(bytes))[0].fill.image.assetId).toContain('media/');
});

it.each([
  ['linked image',(doc,fill)=>fill.getElementsByTagNameNS(A,'blip')[0].setAttributeNS(R,'r:link','external')],
  ['collapsed destination',(doc,fill)=>fill.getElementsByTagNameNS(A,'fillRect')[0].setAttribute('l','100000')],
  ['invalid destination',(doc,fill)=>fill.getElementsByTagNameNS(A,'fillRect')[0].setAttribute('l','oops')],
  ['invalid DPI',(doc,fill)=>fill.setAttribute('dpi','-1')],
  ['conflicting fills',(doc,fill)=>fill.parentElement.append(doc.createElementNS(A,'a:noFill'))],
  ['conflicting tile',(doc,fill)=>fill.append(doc.createElementNS(A,'a:tile'))],
])('rejects %s before editing',async(_,change)=>{
  await expect(DocxPackage.open(changed(change))).rejects.toThrow();
});
