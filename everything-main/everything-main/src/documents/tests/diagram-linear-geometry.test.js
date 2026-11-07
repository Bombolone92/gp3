import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {parseXml} from '../src/engine/docx-xml.js';
import {readDiagramDataModel} from '../src/engine/diagram-data-model.js';
import {buildDiagramLayoutTree} from '../src/engine/diagram-layout-tree.js';
import {solveDiagramLinearGeometry} from '../src/engine/diagram-linear-geometry.js';
let dom;beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;});afterAll(()=>dom.window.close());
const folder='tests/fixtures/diagram-linear-sizing/';
const parts=unzipSync(readFileSync(folder+'control.docx'));
const cases=JSON.parse(readFileSync(folder+'cases.json','utf8'));
const reference=JSON.parse(readFileSync(folder+'reference.json','utf8'));
const root=bytes=>parseXml(bytes).documentElement;
const tree=index=>buildDiagramLayoutTree(root(parts[`word/diagrams/layout${index}.xml`]),readDiagramDataModel(root(parts[`word/diagrams/data${index}.xml`])));
it('binds all native sizing evidence to the exact input',()=>{
 for(const [file,hash]of Object.entries(reference.hashes))expect(createHash('sha256').update(readFileSync(folder+file)).digest('hex')).toBe(hash);
 expect(reference.pages).toHaveLength(12);
});
it.each(cases.slice(0,11).map((c,i)=>[c.name,i,c]))('resolves horizontal constraints near the native reference geometry: %s',(_,index,c)=>{
 const {boxes,pending}=solveDiagramLinearGeometry(tree(index),c.width,c.height);
 expect(pending).toEqual([]);
 const shapes=boxes.filter(b=>b.node.algorithm.type==='tx');expect(shapes).toHaveLength(3);
 expect(reference.pages[index]).toHaveLength(3);
 for(const [i,box]of shapes.entries()){
  const native=reference.pages[index][i];
  // The native reference fitting stops slightly short of the exact mathematical fit.
  // Keep that residual visible; do not encode an unproven rounding algorithm.
  expect(Math.abs(box.x+36-native.x)).toBeLessThan(.25);
  expect(Math.abs(box.y+59.98-native.y)).toBeLessThan(.1);
  expect(Math.abs(box.width-native.width)).toBeLessThan(.15);
  expect(Math.abs(box.height-native.height)).toBeLessThan(.1);
 }
});
it('rejects unverified vertical placement',()=>expect(()=>solveDiagramLinearGeometry(tree(11),120,300)).toThrow('unsupported linear parameters'));
it('reports pending non-geometric work instead of treating it as supported',()=>{
 const t=tree(7);t.children[0].constraints.push(root('<d:constr xmlns:d="http://schemas.openxmlformats.org/drawingml/2006/diagram" type="primFontSz" val="65"/>'));
 expect(solveDiagramLinearGeometry(t,300,120).pending).toHaveLength(1);
});
it('rejects cyclic and conflicting dimensions',()=>{
 const t=tree(0),w=t.children[0].constraints[0];w.removeAttribute('val');w.setAttribute('refType','w');
 expect(()=>solveDiagramLinearGeometry(t,300,120)).toThrow('cyclic dimensions');
 const other=tree(0);other.children[0].constraints.push(other.children[0].constraints[0].cloneNode(true));
 expect(()=>solveDiagramLinearGeometry(other,300,120)).toThrow('conflicting dimension constraints');
});

it('handles original iterator and signed spacer controls without cached geometry',()=>{
 const folder='tests/fixtures/diagram-layout-selection/';
 const parts=unzipSync(readFileSync(folder+'control.docx'));
 const cases=JSON.parse(readFileSync(folder+'cases.json','utf8'));
 const ref=JSON.parse(readFileSync(folder+'reference.json','utf8'));
 for(const [index,c]of cases.entries()){
  const model=readDiagramDataModel(root(parts[`word/diagrams/data${index}.xml`]));
  const layout=buildDiagramLayoutTree(root(parts[`word/diagrams/layout${index}.xml`]),model);
  const boxes=solveDiagramLinearGeometry(layout,300,120).boxes.filter(b=>b.node.algorithm.type==='tx');
  const native=[...ref.pages[index]].sort((a,b)=>c.dir==='rev'?b.x-a.x:a.x-b.x);
  expect(boxes).toHaveLength(native.length);
  for(const [i,b]of boxes.entries()){
   expect(Math.abs(b.x+36-native[i].x)).toBeLessThan(.25);
   expect(Math.abs(b.width-native[i].width)).toBeLessThan(.25);
  }
 }
});
it('rejects non-finite dimensions and nonpositive occupied widths',()=>{
 const t=tree(8);t.constraints.find(c=>c.getAttribute('forName')==='gap').setAttribute('fact','-2');
 expect(()=>solveDiagramLinearGeometry(t,300,120)).toThrow('nonpositive occupied width');
 expect(()=>solveDiagramLinearGeometry(tree(0),Infinity,120)).toThrow('invalid frame');
 const invalid=tree(0);invalid.children[0].constraints[0].setAttribute('val','NaN');
 expect(()=>solveDiagramLinearGeometry(invalid,300,120)).toThrow('invalid val');
});
