import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { DocxPackage, createDocx } from '../src/engine/docx.js';
import { TextDocument, paragraph, runFormat } from '../src/engine/model.js';
import { typedScriptRuns } from '../src/engine/script-input.js';
const root='tests/fixtures/script-input-context/';
const cases=JSON.parse(readFileSync(root+'cases.json','utf8'));
let dom, source, native;
beforeAll(async()=>{dom=new JSDOM('');globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;source=await DocxPackage.open(readFileSync(root+'control.docx'),{bestEffort:true});native=await DocxPackage.open(readFileSync(root+'native.docx'),{bestEffort:true});});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
const flags=p=>({text:p.runs.map(r=>r.text).join(''),characters:p.runs.flatMap(r=>Array(r.text.length).fill([!!r.cs,!!r.rtl])),mark:[!!p.markFormat.cs,!!p.markFormat.rtl,p.markFormat.fontSize,p.markFormat.fontSizeCs]});
it('matches all 252 native sequential and batch inputs, paragraph marks and undo/redo',()=>{
 let at=0;
 for(const [index,c]of cases.entries()){
  // Resolved component; original style-aware packages are tested separately.
  const doc=new TextDocument([source.paragraphs[index]]);doc.select(1);
  const snapshots=[];
  for(const step of c.steps){snapshots.push(doc.snapshot());doc.replace(step);}
  const count=c.steps.join('').split('\n').length,expected=native.paragraphs.slice(at,at+count).map(flags);at+=count;
  expect(doc.paragraphs.map(flags),`case ${index}`).toEqual(expected);
  for(const before of snapshots.reverse()){expect(doc.undo()).toBe(true);expect(doc.snapshot()).toEqual(before);}
  for(const step of c.steps)expect(doc.redo()).toBe(true);
  expect(doc.paragraphs.map(flags),`redo ${index}`).toEqual(expected);
 }
 expect(at).toBe(native.paragraphs.length);
});
it('retains contextual flags and script sizes through resolved-component serialization',async()=>{
 for(const [index,c]of cases.entries()){
  if(!['क|1| ','क1 ','क|  א','क(א)'].includes(c.steps.join('|')))continue;
  const doc=new TextDocument([source.paragraphs[index]]);doc.select(1);for(const step of c.steps)doc.replace(step);
  // Serialize a new document with explicit resolved formats, not the original
  // source package or source style references without their supporting parts.
  const resolved=doc.paragraphs.map(p=>({...paragraph(),markFormat:runFormat(p.markFormat),runs:p.runs.map(r=>({...runFormat(r),text:r.text}))}));
  const pkg=createDocx(resolved),out=await DocxPackage.open(new Uint8Array(await pkg.export().arrayBuffer()),{bestEffort:true});
  expect(out.paragraphs.map(flags),`reopen ${index}`).toEqual(doc.paragraphs.map(flags));
  expect(out.paragraphs.flatMap(p=>p.runs.map(r=>[r.fontSize,r.fontSizeCs]))).toEqual(doc.paragraphs.flatMap(p=>p.runs.map(r=>[r.fontSize,r.fontSizeCs])));
 }
});
it('uses actual preceding script rather than forced cs on Latin or across a paragraph boundary',()=>{
 const format={cs:true,rtl:false,fontSize:10,fontSizeCs:16};
 expect(typedScriptRuns(' ',format,'A')[0].cs).toBe(false);
 expect(typedScriptRuns(' ',format,'क  ')[0].cs).toBe(true);
 expect(typedScriptRuns(' ',format,'क\n')[0].cs).toBe(false);
 expect(typedScriptRuns(' ',format,'क𐤀')[0].cs).toBe(false);
 const ordinary={fontSize:10};expect(typedScriptRuns(' ',ordinary,'क')).toEqual([{...ordinary,text:' '}]);
});
