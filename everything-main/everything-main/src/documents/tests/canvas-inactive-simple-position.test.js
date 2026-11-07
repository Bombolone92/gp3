import { beforeAll, afterAll, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
import { pageGeometry } from '../src/engine/page-settings.js';
import { layoutDocument, imageAtPoint } from '../src/engine/layout.js';
let dom;
beforeAll(() => { dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer; });
afterAll(() => dom.window.close());
const model=p=>new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
const measure=(text,style)=>({width:text.length*style.fontSize*.45,ascent:style.fontSize,descent:style.fontSize/3});
const layout=d=>layoutDocument(d.paragraphs,measure,pageGeometry(d.pageSettings),d.numbering,d.tables);
const save=async(p,d)=>unzipSync(new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer()));
for(const suffix of ['']) {
 const source=readFileSync(`tests/fixtures/inactive-simple-position/control${suffix}.docx`);
 const refs=JSON.parse(readFileSync('tests/fixtures/inactive-simple-position/reference.json')).cases[suffix||'modern'];
 it(`ignores inactive simple coordinates and matches native frames and retains drawing XML ${suffix}`,async()=>{
  const p=await DocxPackage.open(source),d=model(p),before=layout(d);
  expect(before.pageCount).toBe(4);expect(before.floatingObjects).toHaveLength(4);
  for(const [i,f] of before.floatingObjects.entries()){
   const expected=refs[i].images[0];expect(f.page).toBe(i);
   expect(f.x*3/4).toBeCloseTo(expected[0],0);
   expect(f.y*3/4).toBeCloseTo(expected[1],0);
   expect(f.width*3/4).toBeCloseTo(expected[2],0);expect(f.height*3/4).toBeCloseTo(expected[3],0);
   expect(f.cellClip).toBeUndefined();
   expect(imageAtPoint(before,f.page,f.x+2,f.y+2)?.image.id).toBe(f.image.id);
  }
  const exact=parts=>{expect(Object.keys(parts).sort()).toEqual(Object.keys(p.parts).sort());for(const[n,b]of Object.entries(p.parts))expect(Buffer.from(parts[n]).equals(Buffer.from(b)),n).toBe(true);};
  exact(await save(p,d));d.select(d.text.indexOf('Anchor cell'));d.replace('Edited ');
  const edited=await save(p,d),again=model(await DocxPackage.open(zipSync(edited)));
  expect(layout(again).floatingObjects.map(f=>[f.page,f.x,f.y,f.width,f.height])).toEqual(before.floatingObjects.map(f=>[f.page,f.x,f.y,f.width,f.height]));
  for(const[n,b]of Object.entries(p.parts))if(n!=='word/document.xml')expect(Buffer.from(edited[n]).equals(Buffer.from(b)),n).toBe(true);
  d.undo();exact(await save(p,d));
 },30000);
}

it.each([
 ['active',null],['fraction','1.5'],['overflow','27273042316901'],['underflow','-27273042329601'],['missing',null],['text',null],['child',null],['attribute',null]
])('rejects invalid or active simple positioning: %s',async(kind,value)=>{
 const parts=unzipSync(readFileSync('tests/fixtures/inactive-simple-position/control.docx'));
 const xml=new DOMParser().parseFromString(strFromU8(parts['word/document.xml']),'application/xml'),wp='http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
 const anchor=xml.getElementsByTagNameNS(wp,'anchor')[0],simple=anchor.getElementsByTagNameNS(wp,'simplePos')[0];
 if(kind==='active')anchor.setAttribute('simplePos','true');
 else if(kind==='missing')simple.removeAttribute('x');
 else if(kind==='text')simple.textContent='bad';
 else if(kind==='child')simple.appendChild(xml.createElementNS(wp,'wp:extra'));
 else if(kind==='attribute')simple.setAttribute('extra','0');
 else simple.setAttribute('x',value);
 parts['word/document.xml']=strToU8(new XMLSerializer().serializeToString(xml));
 await expect(DocxPackage.open(zipSync(parts))).rejects.toThrow(/simple position|simplePos/);
});
it('retains the native reference guard for an omitted simplePos flag',async()=>{
 await expect(DocxPackage.open(readFileSync('tests/fixtures/inactive-simple-position/omitted-flag.docx'))).rejects.toThrow(/simplePos/);
});
