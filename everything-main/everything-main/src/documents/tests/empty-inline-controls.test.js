import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { DocxPackage, W } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
import { contentControlRanges } from '../src/engine/content-controls.js';
import { blockControlGroups } from '../src/engine/block-controls.js';
const root = 'tests/fixtures/empty-inline-controls/';
const source = 'tests/fixtures/persistent-block-controls/boundary-matrix/replace-erase-cross-start.docx';
const refs = JSON.parse(readFileSync(root+'native/native-results.json','utf8').replace(/^\uFEFF/,''));
const model = p => new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
const save = async (p,d) => new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
const title = c => new DOMParser().parseFromString(c.shell,'application/xml').getElementsByTagNameNS(W,'alias')[0].getAttributeNS(W,'val');
const ranges = d => contentControlRanges(d.paragraphs);
const target = d => ranges(d).find(r=>title(r.control)==='replace');
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});

it('binds native evidence and the independently authored empty controls to hashes',()=>{
  for(const [path,hash] of Object.entries(JSON.parse(readFileSync(root+'native/hashes.json','utf8'))))
    expect(createHash('sha256').update(readFileSync(path)).digest('hex')).toBe(hash);
});

for(const ref of refs) it(`imports and preserves native ${ref.name}`,async()=>{
  const bytes=readFileSync(root+`native/${ref.name}.docx`),p=await DocxPackage.open(bytes),d=model(p),r=target(d);
  expect(r).toBeDefined();expect(d.text.slice(r.start,r.end)).toBe(ref.text||'');
  expect(d.text).toBe(ref.after.replace(/\r$/,'').replaceAll('\r','\n'));
  expect(unzipSync(await save(p,d))).toEqual(unzipSync(bytes));
});

for(const name of ['inside','delete-previous','delete-next','clear-after-entry']) it(`matches the native reference for ${name} at an empty control`,async()=>{
  const p=await DocxPackage.open(readFileSync(source)),d=model(p),ref=refs.find(r=>r.name===name);
  const r=target(d);expect(r.start).toBe(r.end);d.select(r.start);
  if(name==='delete-previous')d.delete(-1);
  else if(name==='delete-next')d.delete(1);
  else {d.replace('Typed');if(name==='clear-after-entry'){const r=target(d);d.select(r.start,r.end);d.replace('');}}
  const saved=await save(p,d),again=model(await DocxPackage.open(saved));
  for(const current of [d,again]){const r=target(current);expect(current.text).toBe(ref.after.replace(/\r$/,'').replaceAll('\r','\n'));expect(current.text.slice(r.start,r.end)).toBe(ref.text||'');}
  for(const [name,data] of Object.entries(p.parts))if(name!=='word/document.xml')expect(unzipSync(saved)[name]).toEqual(data);
  while(d.history.length)d.undo();expect(unzipSync(await save(p,d))).toEqual(p.parts);
});

it('preserves start, middle, end, standalone and adjacent empty controls through surrounding edits',async()=>{
  const p=await DocxPackage.open(readFileSync(root+'control.docx')),d=model(p);
  expect(d.text).toBe('Start suffix\nMiddle prefix  suffix\nEnd prefix\n\nAdjacent  suffix');
  expect(ranges(d).map(r=>title(r.control))).toEqual(['start','middle','end','alone','left','right']);
  expect(ranges(d).every(r=>r.start===r.end)).toBe(true);
  expect(unzipSync(await save(p,d))).toEqual(p.parts);
  d.replaceMatches('prefix','expanded prefix',{},true);
  d.select(0,d.text.length);d.toggleBold();
  d.select(d.text.indexOf('Middle')+2);d.replace('\n');
  const again=model(await DocxPackage.open(await save(p,d)));
  expect(again.text).toBe(d.text);
  for(const current of [d,again]){
    expect(ranges(current).map(r=>title(r.control))).toEqual(['start','middle','end','alone','left','right']);
    expect(ranges(current).every(r=>r.start===r.end)).toBe(true);
  }
  while(d.history.length)d.undo();expect(unzipSync(await save(p,d))).toEqual(p.parts);
});

it('keeps a rejected paragraph split atomic at a zero-length inline control',async()=>{
  const p=await DocxPackage.open(readFileSync(source)),d=model(p);d.select(target(d).start);const before=d.snapshot();
  expect(()=>d.replace('X\nY')).toThrow('paragraph break');expect(d.snapshot()).toEqual(before);expect(d.history).toHaveLength(0);
});

const glossaryRefs=JSON.parse(readFileSync(root+'glossary/native-results.json','utf8').replace(/^\uFEFF/,''));
for(const ref of glossaryRefs)it(`restores declared glossary after crossing ${ref.name} with ${JSON.stringify(ref.replacement)}`,async()=>{
  const p=await DocxPackage.open(readFileSync(root+'glossary/control.docx')),d=model(p);
  const r=blockControlGroups(d.paragraphs).find(r=>title(r.control)===ref.name);
  d.select(r.start-1,r.end);d.replace(ref.replacement);
  const bytes=await save(p,d),again=model(await DocxPackage.open(bytes));
  for(const current of [d,again]){
    expect(current.text).toBe(ref.after.replace(/\r$/,'').replaceAll('\r','\n'));
    const c=ranges(current).find(r=>title(r.control)===ref.name);
    expect(current.text.slice(c.start,c.end)).toBe(ref.controlText);expect(c.control.placeholder).toBe(true);
    expect(c.runs[0].bold).toBe(true);
  }
  for(const[name,data]of Object.entries(p.parts))if(name!=='word/document.xml')expect(unzipSync(bytes)[name]).toEqual(data);
  d.undo();expect(unzipSync(await save(p,d))).toEqual(p.parts);
});
