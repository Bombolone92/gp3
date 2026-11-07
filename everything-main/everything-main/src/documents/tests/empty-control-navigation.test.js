import { MAX_DOCUMENT_CHARACTERS } from '../src/engine/text-limits.js';
import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument, boundaries } from '../src/engine/model.js';
import { contentControlRanges } from '../src/engine/content-controls.js';
import { moveInlineControlCaret, documentStartControlCaret } from '../src/engine/content-control-caret.js';
const root='tests/fixtures/empty-control-navigation/';
const reference=JSON.parse(readFileSync(root+'reference.json','utf8'));
const model=p=>new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
const save=async(p,d)=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
function move(d,direction){
  const stops=boundaries(d.text),at=d.selection.focus;
  const target=direction>0?stops.find(p=>p>at)??d.text.length:[...stops].reverse().find(p=>p<at)??0;
  const next=moveInlineControlCaret(d.paragraphs,d.selection,target,direction);
  if(next?.restoreEmpty)d.leaveEmptyControl(next.controlCaret.side);
  else if(next)d.select(next.anchor,next.focus,next.controlCaret);else d.select(target);
}

it('document Home enters the leading empty wrapper without editing it',async()=>{
  const p=await DocxPackage.open(readFileSync('tests/fixtures/empty-inline-controls/control.docx')),d=model(p);
  d.select(0,0,documentStartControlCaret(d.paragraphs));
  expect(d.selection.controlCaret).toEqual({id:contentControlRanges(d.paragraphs)[0].control.id,side:'inside'});
  expect(d.history).toHaveLength(0);expect(unzipSync(await save(p,d))).toEqual(p.parts);
  move(d,1);move(d,1);d.replace('X');
  expect(d.text.split('\n')[0]).toBe('     SXtart suffix');
  d.undo();d.undo();expect(unzipSync(await save(p,d))).toEqual(p.parts);
});

it('document Home leaves other control types and nonleading controls alone',()=>{
  for(const control of [{persistent:false},{persistent:true,plainText:true},{persistent:true,picture:true}])
    expect(documentStartControlCaret([{runs:[{text:'',contentControl:{id:'a',...control}}]}])).toBeNull();
  for(const runs of [[{text:'A'},{text:'',contentControl:{id:'a',persistent:true}}],[{text:'A',contentControl:{id:'a',persistent:true}}],[]])
    expect(documentStartControlCaret([{runs}])).toBeNull();
});
for(const ref of reference.cases)it(`matches the native reference empty-control ${ref.name}`,async()=>{
  for(const [file,hash] of [[ref.source,ref.sourceSha256],[ref.result,ref.resultSha256]])expect(createHash('sha256').update(readFileSync(root+file)).digest('hex')).toBe(hash);
  const p=await DocxPackage.open(readFileSync(root+ref.source)),d=model(p),native=model(await DocxPackage.open(readFileSync(root+ref.result)));
  for(const key of ref.keys){if(key==='Home')d.select(0);else if(key==='Undo')d.undo();else if(key==='X')d.replace('X');else move(d,key==='Right'?1:-1);}
  const r=contentControlRanges(d.paragraphs)[0];expect(d.text).toBe(native.text);expect(d.text).toBe(ref.text);
  if(ref.name==='inside'||ref.name==='undo')expect(d.selection.controlCaret.side).toBe('inside');
  expect(d.text.slice(r.start,r.end)).toBe(ref.controlText);expect(!!r.control.placeholder).toBe(ref.placeholder);
  if(ref.name==='glossary-typed'){
    const actual=d.paragraphs.flatMap(p=>p.runs).find(r=>r.text.includes('X'));
    const expected=native.paragraphs.flatMap(p=>p.runs).find(r=>r.text.includes('X'));
    expect(!!actual.bold).toBe(!!expected.bold);
  }
  if(ref.name.startsWith('glossary'))expect(r.runs.some(r=>r.bold)).toBe(true);
  const bytes=await save(p,d),parts=unzipSync(bytes),again=model(await DocxPackage.open(bytes));expect(again.text).toBe(d.text);
  for(const[name,data]of Object.entries(p.parts))if(name!=='word/document.xml')expect(parts[name]).toEqual(data);
  while(d.history.length)d.undo();expect(unzipSync(await save(p,d))).toEqual(p.parts);
});

for(const direction of [-1,1])it(`restores adjacent empty controls in direction ${direction}`,async()=>{
  const p=await DocxPackage.open(readFileSync('tests/fixtures/empty-inline-controls/control.docx')),d=model(p);
  const controls=contentControlRanges(d.paragraphs).slice(-2),first=direction>0?controls[0]:controls[1];
  d.select(first.start,first.start,{id:first.control.id,side:direction>0?'before':'after'});
  move(d,direction);expect(d.history).toHaveLength(0);move(d,direction);expect(d.history).toHaveLength(1);
  move(d,direction);move(d,direction);
  expect(contentControlRanges(d.paragraphs).slice(-2).map(r=>d.text.slice(r.start,r.end))).toEqual(['     ','     ']);
  expect(d.history).toHaveLength(2);d.undo();d.undo();expect(unzipSync(await save(p,d))).toEqual(p.parts);
});

it('rejects restoration outside an empty control without changing the document',async()=>{
  const d=model(await DocxPackage.open(readFileSync(root+'control.docx'))),before=d.snapshot();
  expect(()=>d.leaveEmptyControl('after')).toThrow('not inside');expect(d.snapshot()).toEqual(before);
  expect(()=>d.replace('',{restoreEmptyControl:true})).toThrow('Only an empty');expect(d.snapshot()).toEqual(before);
  expect(d.replace('')).toBe(false);
});

it('rejects prompt restoration atomically at the document character limit',async()=>{
  const p=await DocxPackage.open(readFileSync(root+'control.docx'));
  p.paragraphs[0].runs[0].text='A'.repeat(MAX_DOCUMENT_CHARACTERS - 1);const d=model(p);expect(d.text.length).toBe(MAX_DOCUMENT_CHARACTERS);
  const r=contentControlRanges(d.paragraphs)[0];d.select(r.start,r.start,{id:r.control.id,side:'inside'});
  const before=d.snapshot();expect(()=>d.leaveEmptyControl('after')).toThrow('5,000,000');expect(d.snapshot()).toEqual(before);expect(d.history).toHaveLength(0);
});
