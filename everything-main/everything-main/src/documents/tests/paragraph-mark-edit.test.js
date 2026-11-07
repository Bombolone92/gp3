import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
const root = 'tests/fixtures/paragraph-mark-edit/';
const cases = JSON.parse(readFileSync(root+'cases.json','utf8'));
const records = JSON.parse(readFileSync(root+'records.json','utf8'));
const recording = JSON.parse(readFileSync(root+'native-recording.json','utf8'));
let dom, source, native;
const model = pkg => new TextDocument(pkg.paragraphs,pkg.pageSettings,pkg.numbering,pkg.styles,pkg.tables,pkg.assets);
const save = async doc => new Uint8Array(await source.export(doc.paragraphs,doc.pageSettings,doc.numbering,doc.styles,doc.tables,doc.assets).arrayBuffer());
const summary = p => ({ text:p.runs.map(r=>r.text).join(''), mark:[p.markFormat.fontSize,p.markFormat.color], characters:p.runs.flatMap(r=>[...r.text].map(text=>[text,r.fontSize,r.color])) });
beforeAll(async()=>{dom=new JSDOM('');globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;source=await DocxPackage.open(readFileSync(root+'control.docx'));native=await DocxPackage.open(readFileSync(root+'native.docx'));});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
it('binds native paragraph operations to their original source, case list and recorded output',()=>{
 for(const [name,hash] of Object.entries(recording.hashes))expect(createHash('sha256').update(readFileSync(root+name)).digest('hex')).toBe(hash);
 let at=0;
 for(let i=0;i<cases.length;i++){const record=records.find(r=>r.index===i);expect(native.paragraphs.slice(at,at+record.count).map(p=>summary(p).text+'\r')).toEqual(record.texts);at+=record.count;}
 expect(at).toBe(native.paragraphs.length);
});
it('matches the native reference mark ownership on splits and replacements, including export, reversed selection and exact undo',async()=>{
 let at=0;
 for(const [index,c] of cases.entries()){
  const count=records.find(r=>r.index===index).count, expected=native.paragraphs.slice(at,at+count).map(summary);at+=count;
  // Native Selection.Delete preserves a break for this deletion.
  // That separate selection behavior remains unresolved; do not assert our result as native.
  if(c.name==='merge-middle')continue;
  for(const reverse of [false,true]){
   const doc=model(source),start=doc.paragraphOffset(index*2)+c.start,end=doc.paragraphOffset(index*2)+c.end;
   doc.select(...(reverse?[end,start]:[start,end]));const before=doc.snapshot();doc.replace(c.text);
   expect(doc.paragraphs.slice(index*2,index*2+count).map(summary),c.name).toEqual(expected);
   const bytes=await save(doc),out=await DocxPackage.open(bytes);
   expect(out.paragraphs.slice(index*2,index*2+count).map(summary),c.name+' reopened').toEqual(expected);
   for(const [name,part]of Object.entries(source.parts))if(name!=='word/document.xml')expect(unzipSync(bytes)[name],name).toEqual(part);
   doc.undo();expect(doc.snapshot()).toEqual(before);expect(unzipSync(await save(doc))).toEqual(source.parts);
   doc.redo();expect(doc.paragraphs.slice(index*2,index*2+count).map(summary)).toEqual(expected);
  }
 }
},30000);
