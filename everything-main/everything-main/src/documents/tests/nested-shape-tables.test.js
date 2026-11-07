import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {unzipSync,strFromU8} from 'fflate';
import {DocxPackage,W} from '../src/engine/docx.js';
import {pageGeometry} from '../src/engine/page-settings.js';
import {TextDocument} from '../src/engine/model.js';
import {layoutShapeText} from '../src/engine/shape-text-layout.js';
import {expectBodyEditParts} from './helpers/expect-body-edit-parts.js';
const source=readFileSync('tests/fixtures/nested-shape-tables/control.docx');
const ref=JSON.parse(readFileSync('tests/fixtures/nested-shape-tables/reference.json'));
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>dom.window.close());
it('retains physical cell padding while placing all sixteen nested table controls at native X positions',async()=>{
  const pkg=await DocxPackage.open(source), shapes=Object.values(pkg.assets).filter(a=>a.scene?.text).map(a=>a.scene);
  expect(shapes).toHaveLength(16);
  const measure=(t,s)=>({width:t.length*s.fontSize*.5,ascent:s.fontSize,descent:s.fontSize/3});
  for(const [i,node] of shapes.entries()) {
    const before=JSON.stringify(node.text.tables), text=layoutShapeText(node,measure);
    for(const native of ref.lines.filter(l=>l.page===i&&l.text.startsWith('S '))) {
      const line=text.layout.lines.find(l=>l.fragments.map(f=>f.text).join('').trim()===native.text);
      expect(line).toBeTruthy();expect(Math.abs((pageGeometry(pkg.pageSettings).left+text.left+line.fragments[0].x)*.75-native.x),`${i} ${native.text}`).toBeLessThan(.2);
    }
    expect(JSON.stringify(node.text.tables)).toBe(before);
  }
});
it('preserves drawing markup and unrelated package parts through body editing and undo',async()=>{
  const pkg=await DocxPackage.open(source), d=new TextDocument(pkg.paragraphs,pkg.pageSettings,pkg.numbering,pkg.styles,pkg.tables,pkg.assets);
  const save=async()=>new Uint8Array(await pkg.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
  d.select(0);d.replace('Edited ');const bytes=await save(),out=unzipSync(bytes),again=await DocxPackage.open(bytes);
  expectBodyEditParts(out,pkg.parts);
  const drawingXml = bytes => {
    const xml = new DOMParser().parseFromString(strFromU8(bytes), 'application/xml');
    return [...xml.getElementsByTagNameNS(W, 'drawing')].map(n => [...n.getElementsByTagName('*')].map(e => [e.namespaceURI, e.localName, [...e.attributes].filter(a => a.namespaceURI !== 'http://www.w3.org/2000/xmlns/').map(a => [a.namespaceURI,a.localName,a.value]).sort(), e.children.length ? '' : e.textContent]));
  };
  expect(drawingXml(out['word/document.xml'])).toEqual(drawingXml(pkg.parts['word/document.xml']));
  expect(Object.values(again.assets).filter(a=>a.scene?.text)).toHaveLength(16);
  expect(again.paragraphs[0].runs.map(r=>r.text).join('')).toMatch(/^Edited /);
  d.undo();expect(unzipSync(await save())).toEqual(pkg.parts);
},30000); // Sixteen retained table drawings are imported twice and compared in full.
