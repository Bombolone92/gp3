import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {parseXml} from '../src/engine/docx-xml.js';
const folder='tests/fixtures/diagram-order-normalization/',D='http://schemas.openxmlformats.org/drawingml/2006/diagram',R='http://schemas.openxmlformats.org/officeDocument/2006/relationships',A='http://schemas.openxmlformats.org/drawingml/2006/main';
let dom;beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;});afterAll(()=>dom.window.close());
function orders(file){
 const parts=unzipSync(readFileSync(folder+file)),doc=parseXml(parts['word/document.xml']),refs=doc.getElementsByTagNameNS(D,'relIds');expect(refs).toHaveLength(1);
 const id=refs[0].getAttributeNS(R,'dm'),rels=parseXml(parts['word/_rels/document.xml.rels']);
 const target=[...rels.documentElement.children].find(n=>n.getAttribute('Id')===id).getAttribute('Target');
 const path=new URL(target,'https://docx.invalid/word/document.xml').pathname.slice(1),root=parseXml(parts[path]);
 const points=new Map([...root.getElementsByTagNameNS(D,'pt')].map(n=>[n.getAttribute('modelId'),n]));
 const result={};for(const c of root.getElementsByTagNameNS(D,'cxn'))if((c.getAttribute('type')||'parOf')==='parOf'){
  const point=points.get(c.getAttribute('destId')),color=point.getElementsByTagNameNS(A,'srgbClr')[0].getAttribute('val');result[color]=Number(c.getAttribute('srcOrd'));
 }return result;
}
it('records native reference ordinal normalization separately from the proposed traversal implementation',()=>{
 const hashes=JSON.parse(readFileSync(folder+'hashes.json','utf8'));
 for(const [name,hash]of Object.entries(hashes))expect(createHash('sha256').update(readFileSync(folder+name)).digest('hex')).toBe(hash);
 expect(orders('control.docx')).toEqual({CC4422:2,'8040C0':1,'228844':0});
 expect(orders('native.docx')).toEqual({CC4422:0,'8040C0':1,'228844':2});
});
import {DocxPackage} from '../src/engine/docx.js';
import {readDiagramDataModel,diagramDataChildren} from '../src/engine/diagram-data-model.js';

it('preserves native declared order with a non-nil root and the nil-root repair behavior',async()=>{
 for(const [file,expected]of [['control.docx',['CC4422','8040C0','228844']],['control-nonzero.docx',['228844','8040C0','CC4422']]]){
  const parts=unzipSync(readFileSync(folder+file));const graph=readDiagramDataModel(parseXml(parts['word/diagrams/data1.xml']).documentElement);
  expect(diagramDataChildren(graph).map(n=>n.xml.getElementsByTagNameNS(A,'srgbClr')[0].getAttribute('val'))).toEqual(expected);
  globalThis.XMLSerializer=dom.window.XMLSerializer;
  const pkg=await DocxPackage.open(readFileSync(folder+file));expect(pkg.readOnly).not.toBe(true);
  const scene=Object.values(pkg.assets).find(a=>a.scene).scene;
  expect(scene.children.map(s=>s.fill)).toEqual(expected.map(c=>'#'+c));
  expect(scene.children.map(s=>s.x)).toEqual([...scene.children.map(s=>s.x)].sort((a,b)=>a-b));
  const exported=unzipSync(new Uint8Array(await pkg.export().arrayBuffer()));for(const key of Object.keys(parts))expect(Buffer.from(exported[key]).equals(Buffer.from(parts[key])),key).toBe(true);
 }
 expect(orders('control-nonzero.docx')).toEqual(orders('native-nonzero.docx'));
});
