import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {parseXml} from '../src/engine/docx-xml.js';
import {readDiagramDataModel} from '../src/engine/diagram-data-model.js';
import {buildDiagramLayoutTree} from '../src/engine/diagram-layout-tree.js';
import {resolveDiagramStyles} from '../src/engine/diagram-styling.js';
import {readShapeScene} from '../src/engine/docx-shapes.js';
import {drawingStyleReader} from '../src/engine/docx-drawing-style.js';
const D='http://schemas.openxmlformats.org/drawingml/2006/diagram',A='http://schemas.openxmlformats.org/drawingml/2006/main',WPS='http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
const folder='tests/fixtures/diagram-styling/',parts=unzipSync(readFileSync(folder+'control.docx'));
const cases=JSON.parse(readFileSync(folder+'cases.json','utf8')),ref=JSON.parse(readFileSync(folder+'reference.json','utf8'));
const root=b=>parseXml(b).documentElement;
let dom;beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});afterAll(()=>dom.window.close());
function inputs(i){return {nodes:buildDiagramLayoutTree(root(parts[`word/diagrams/layout${i}.xml`]),readDiagramDataModel(root(parts[`word/diagrams/data${i}.xml`]))).children,style:root(parts[`word/diagrams/style${i}.xml`]),colors:root(parts[`word/diagrams/colors${i}.xml`])};}
function scene(record){
 const shape=root(`<wps:wsp xmlns:wps="${WPS}" xmlns:a="${A}"><wps:cNvPr id="1" name="Style control"/><wps:cNvSpPr/><wps:spPr/><wps:bodyPr/></wps:wsp>`),props=shape.getElementsByTagNameNS(WPS,'spPr')[0];
 for(const c of [...record.properties.children])props.append(c.cloneNode(true));
 const geometry=root(`<a:spPr xmlns:a="${A}"><a:xfrm><a:off x="0" y="0"/><a:ext cx="1270000" cy="508000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></a:spPr>`);
 props.prepend(...[...geometry.children]);
 if(record.style){const style=shape.ownerDocument.createElementNS(WPS,'wps:style');for(const c of record.style.children)style.append(c.cloneNode(true));shape.insertBefore(style,shape.lastElementChild);}
 return readShapeScene(shape,null,null,null,null,null,drawingStyleReader(parts));
}
it('binds native style evidence to its exact source',()=>{
 for(const [file,hash]of Object.entries(ref.hashes))expect(createHash('sha256').update(readFileSync(folder+file)).digest('hex')).toBe(hash);
 expect(ref.pages).toHaveLength(12);
});
it.each(cases.map((c,i)=>[c.name,i]))('matches the initialized native reference fill and stroke precedence: %s',(_,i)=>{
 const {nodes,style,colors}=inputs(i),before=new XMLSerializer().serializeToString(style);
 const records=resolveDiagramStyles(nodes,style,colors);expect(records).toHaveLength(3);
 const fills=ref.pages[i].filter(p=>p.fillMode),strokes=ref.pages[i].filter(p=>p.strokeMode&&p.stroke[3]>0);
 const centers=[...fills,...strokes].map(p=>p.x+p.width/2).sort((a,b)=>a-b).filter((x,i,a)=>i===0||x-a[i-1]>.1);expect(centers).toHaveLength(3);
 for(const [j,r]of records.entries()){
  expect(r.pending).toHaveLength(cases[i].flat?4:0);const s=scene(r),center=centers[j];
  const fill=fills.find(p=>Math.abs(p.x+p.width/2-center)<1),stroke=strokes.find(p=>Math.abs(p.x+p.width/2-center)<1);
  const hex=rgba=>'#'+rgba.slice(0,3).map(v=>v.toString(16).padStart(2,'0')).join('').toUpperCase();
  expect(s.fill).toBe(fill?hex(fill.fill):null);
  expect(s.outline?.color??null).toBe(stroke?hex(stroke.stroke):null);
  if(stroke)expect(s.outline.width/12700).toBeCloseTo(stroke.strokeWidth,5);
 }
 expect(new XMLSerializer().serializeToString(style)).toBe(before);
});
it('rejects ambiguous labels and unverified color distributions',()=>{
 const x=inputs(1);x.style.append(x.style.children[0].cloneNode(true));
 expect(()=>resolveDiagramStyles(x.nodes,x.style,x.colors)).toThrow('duplicate style labels');
 const y=inputs(1);y.colors.getElementsByTagNameNS(D,'fillClrLst')[0].setAttribute('meth','span');
 expect(()=>resolveDiagramStyles(y.nodes,y.style,y.colors)).toThrow('unsupported color distribution');
});


it('keeps native geometry and paint unchanged for plain spaces and flat scene declarations',()=>{
 expect(ref.pages[10]).toEqual(ref.pages[1]);
 expect(ref.pages[11]).toEqual(ref.pages[1]);
});
