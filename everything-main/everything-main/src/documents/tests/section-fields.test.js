import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync,strFromU8} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument} from '../src/engine/model.js';
import {bodyFieldRanges} from '../src/engine/body-fields.js';
import {listMarkers} from '../src/engine/numbering.js';
const root='tests/fixtures/section-fields/',W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const reference=JSON.parse(readFileSync(root+'reference.json','utf8'));
const native=JSON.parse(readFileSync(root+'native-edits.json','utf8').replace(/^\uFEFF/,''));
const model=p=>new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
const save=async(p,d)=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
// Compare native and exported boundary placement without coupling to run splits
// or the unrelated formatting metadata the reference application adds to its in-memory package.
function semantics(xml){
 const doc=new DOMParser().parseFromString(xml,'application/xml');
 return [...doc.getElementsByTagNameNS(W,'p')].map(p=>{
  let at=0;const fields=[];for(const n of p.getElementsByTagNameNS(W,'*')){
   if(n.localName==='t')at+=n.textContent.length;
   if(n.localName==='fldChar')fields.push([at,n.getAttributeNS(W,'fldCharType')]);
  }
  return {text:[...p.getElementsByTagNameNS(W,'t')].map(n=>n.textContent).join(''),fields,section:p.getElementsByTagNameNS(W,'sectPr').length>0};
 });
}
const fieldResults=d=>bodyFieldRanges(d.paragraphs).map(r=>({type:r.field.type,code:r.field.instruction,start:r.start,end:r.end,text:d.text.slice(r.start,r.end)}));
for(const ref of reference.filter(r=>r.name!=='boundaries')){
 it(`${ref.name}: native reference, nested section ranges and untouched package`,async()=>{
  for(const[name,hash]of Object.entries(ref.sha256))expect(createHash('sha256').update(readFileSync(root+name)).digest('hex')).toBe(hash);
  const p=await DocxPackage.open(readFileSync(root+ref.name+'.docx')),d=model(p),ranges=bodyFieldRanges(d.paragraphs);
  expect(ranges).toHaveLength(2);expect(ranges[1].parentId).toBe(ranges[0].field.id);
  expect(d.paragraphs.filter(p=>p.sectionEnd)).toHaveLength(2);
  for(const r of ranges)expect(d.text.slice(r.start,r.end)).toContain('C19 Result after section');
  expect(unzipSync(await save(p,d))).toEqual(p.parts);
 });
 it(`${ref.name}: replacing text inside a section preserves enclosing fields and section properties`,async()=>{
  const p=await DocxPackage.open(readFileSync(root+ref.name+'.docx')),d=model(p);
  const sections=d.paragraphs.filter(p=>p.sectionEnd).map(p=>p.sectionProperties);
  const at=d.text.indexOf('C07');d.select(at,at+3);d.replace('Replaced');
  const again=model(await DocxPackage.open(await save(p,d)));
  expect(fieldResults(again)).toEqual(fieldResults(d));
  expect(again.paragraphs.filter(p=>p.sectionEnd).map(p=>p.sectionProperties)).toEqual(sections);
  d.undo();expect(unzipSync(await save(p,d))).toEqual(p.parts);
 });
 it(`${ref.name}: partial field deletion across a section break remains atomic and guarded`,async()=>{
  const p=await DocxPackage.open(readFileSync(root+ref.name+'.docx')),d=model(p);
  d.select(d.text.indexOf('C02'),d.text.indexOf('C03')+3);const before=d.snapshot();
  expect(()=>d.replace('X')).toThrow('body field boundary');expect(d.snapshot()).toEqual(before);
 });
}
it('retains marker-only boundary paragraphs and numbers them as the native reference does',async()=>{
 const ref=reference.find(r=>r.name==='boundaries');
 for(const[name,hash]of Object.entries(ref.sha256))expect(createHash('sha256').update(readFileSync(root+name)).digest('hex')).toBe(hash);
 const p=await DocxPackage.open(readFileSync(root+'boundaries.docx')),d=model(p);
 expect(bodyFieldRanges(d.paragraphs)).toHaveLength(5);
 expect(listMarkers(d.paragraphs,d.numbering).filter(Boolean).map(m=>m.text)).toEqual(['1.','2.']);
 expect(unzipSync(await save(p,d))).toEqual(p.parts);
});
for(const ref of native.cases)it(`${ref.source}: matches the native reference ${ref.action}, export, reopen and exact undo`,async()=>{
 const source=readFileSync(root+ref.source+'.docx');
 expect(createHash('sha256').update(source).digest('hex').toUpperCase()).toBe(ref.sourceSha256);
 expect(ref.sections).toBe(3);
 const p=await DocxPackage.open(source),d=model(p),label=ref.action==='insert'?'C19 Result':ref.action==='split'?'C02 Result':'C03 Cached';
 const at=d.text.indexOf(label);expect(at).toBeGreaterThan(0);
 if(ref.action==='format'){d.select(at,at+label.length);d.toggleBold();}
 else {d.select(at+5);d.replace(ref.action==='insert'?'X':'\n');}
 const out=await save(p,d),parts=unzipSync(out),again=model(await DocxPackage.open(out));
 expect(semantics(strFromU8(parts['word/document.xml']))).toEqual(semantics(ref.documentXml));
 expect(again.text).toBe(d.text);expect(fieldResults(again)).toEqual(fieldResults(d));
 expect(again.paragraphs.filter(p=>p.sectionEnd).map(p=>p.sectionProperties)).toEqual(p.paragraphs.filter(p=>p.sectionEnd).map(p=>p.sectionProperties));
 for(const[name,bytes]of Object.entries(p.parts))if(name!=='word/document.xml')expect(parts[name]).toEqual(bytes);
 d.undo();expect(unzipSync(await save(p,d))).toEqual(p.parts);
});
