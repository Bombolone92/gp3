import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { parseXml } from '../src/engine/docx-xml.js';
import { readDiagramDataModel, diagramDataChildren } from '../src/engine/diagram-data-model.js';

const DGM='http://schemas.openxmlformats.org/drawingml/2006/diagram';
const A='http://schemas.openxmlformats.org/drawingml/2006/main';
const folder='tests/fixtures/diagram-linear-layout/';
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>dom.window.close());
const read=text=>readDiagramDataModel(parseXml(text).documentElement);
const model=(points,edges)=>`<d:dataModel xmlns:d="${DGM}"><d:ptLst><d:pt modelId="0" type="doc"/>${points}</d:ptLst><d:cxnLst>${edges}</d:cxnLst></d:dataModel>`;
const point=id=>`<d:pt modelId="${id}"/>`;
const edge=(id,src,dst)=>`<d:cxn modelId="${id}" srcId="${src}" destId="${dst}"/>`;

it('matches independently regenerated native reference node order across directions and storage permutations',()=>{
 const reference=JSON.parse(readFileSync(folder+'reference.json','utf8'));
 for(const [name,hash]of Object.entries(reference.hashes))expect(createHash('sha256').update(readFileSync(folder+name)).digest('hex')).toBe(hash);
 const cases=JSON.parse(readFileSync(folder+'cases.json','utf8')),parts=unzipSync(readFileSync(folder+'control.docx'));
 expect(cases).toHaveLength(11);expect(reference.pages).toHaveLength(cases.length);
 for(const [index,testCase]of cases.entries()){
  const document=parseXml(parts[`word/diagrams/data${index}.xml`]),before=new XMLSerializer().serializeToString(document);
  const graph=readDiagramDataModel(document.documentElement),ordered=diagramDataChildren(graph);
  expect(ordered).toHaveLength(testCase.count);
  const native=[...reference.pages[index]].sort((a,b)=>['fromL','fromR'].includes(testCase.direction)?a.x-b.x:a.y-b.y);
  if(['fromR','fromB'].includes(testCase.direction))native.reverse();
  const colors=ordered.map(p=>p.xml.getElementsByTagNameNS(A,'srgbClr')[0].getAttribute('val').toLowerCase());
  expect(colors).toEqual(native.map(s=>s.color.slice(0,3).map(v=>v.toString(16).padStart(2,'0')).join('')));
  // Check geometry came from recalculation: stale saved shapes are 20x10pt.
  for(const shape of native){expect(shape.width).toBeGreaterThan(50);expect(shape.height).toBeGreaterThan(50);}
  expect(new XMLSerializer().serializeToString(document)).toBe(before);
 }
});

it('retains nested topology and declared ordinals without substituting presentation points',()=>{
 const graph=read(model(point(1)+point(2)+point(3)+'<d:pt modelId="4" type="pres"/>',
  '<d:cxn modelId="10" srcId="0" destId="2" srcOrd="0" destOrd="3"/>'+edge(11,0,1)+edge(12,1,3)+'<d:cxn modelId="13" type="presOf" srcId="1" destId="4"/>'));
 expect(diagramDataChildren(graph).map(p=>p.id)).toEqual(['1','2']);
 expect(diagramDataChildren(graph,graph.points.get('1')).map(p=>p.id)).toEqual(['3']);
 expect(graph.parent.get('3').source.id).toBe('1');
 expect(graph.connections.get('10')).toMatchObject({sourceOrder:0,destinationOrder:3});
 expect(graph.points.get('4').type).toBe('pres');
});

it('resolves explicit sibling and parent transition identities',()=>{
 const graph=read(model(point(1)+'<d:pt modelId="2" type="parTrans" cxnId="10"/><d:pt modelId="3" type="sibTrans" cxnId="10"/>',
  '<d:cxn modelId="10" srcId="0" destId="1" parTransId="2" sibTransId="3"/>'));
 expect(diagramDataChildren(graph).map(p=>p.id)).toEqual(['1']);
 expect(graph.points.get('3').xml.getAttribute('cxnId')).toBe('10');
});

it.each([
 [point(1)+point(1),edge(10,0,1)],
 [point(1),edge(10,0,2)],
 [point(1),edge(10,0,1)+edge(10,0,1)],
 [point(1)+point(2),edge(10,0,1)+edge(11,2,1)],
 [point(1)+point(2),edge(10,1,2)+edge(11,2,1)],
 [point(1),''],
 [point(1),'<d:cxn modelId="10" srcId="0" destId="1" srcOrd="-1"/>'],
 [point(1),'<d:cxn modelId="10" srcId="0" destId="1" destOrd="4294967296"/>'],
 [point(1)+'<d:pt modelId="2" type="sibTrans" cxnId="missing"/>',edge(10,0,1)],
 [point(1)+'<d:pt modelId="2" type="parTrans" cxnId="10"/>','<d:cxn modelId="10" srcId="0" destId="1" sibTransId="2"/>'],
])('rejects ambiguous, disconnected or inconsistent graphs (%#)',(points,edges)=>{
 expect(()=>read(model(points,edges))).toThrow('diagram data');
});

it('walks a deep valid parent chain without recursive call-stack limits',()=>{
 const count=12000;
 // Exercise graph depth directly. XML parsing and live DOM collections are
 // covered by the native fixtures above, and are not part of this assertion.
 const node=(localName,attributes={},children=[])=>({namespaceURI:DGM,localName,children,getAttribute:name=>attributes[name]===undefined?null:String(attributes[name])});
 const points=[node('pt',{modelId:0,type:'doc'}),...Array.from({length:count},(_,i)=>node('pt',{modelId:i+1}))];
 const edges=Array.from({length:count},(_,i)=>node('cxn',{modelId:count+i+1,srcId:i,destId:i+1}));
 const graph=readDiagramDataModel(node('dataModel',{},[node('ptLst',{},points),node('cxnLst',{},edges)]));
 expect(graph.parent.size).toBe(count);
 expect(graph.parent.get(String(count)).source.id).toBe(String(count-1));
});
