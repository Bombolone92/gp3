import { beforeAll,afterAll,it,expect,vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
import { listMarkers } from '../src/engine/numbering.js';
vi.setConfig({testTimeout:60000});let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});afterAll(()=>dom.window.close());
const source=readFileSync('public/fixtures/inherited-list-restarts.docx'),refs=JSON.parse(readFileSync('tests/fixtures/inherited-list-restarts/reference.json'));
const model=p=>new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
const labels=d=>listMarkers(d.paragraphs,d.numbering).filter(Boolean).map(m=>m.text);
const save=async(p,d)=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
it('matches all 18 native reference sequences across inherited/direct instances and multilevel resets',async()=>{
 const p=await DocxPackage.open(source),d=model(p),before=JSON.stringify(d.numbering),expected=refs.flatMap(r=>r.markers);
 expect(labels(d)).toEqual(expected);expect(JSON.stringify(d.numbering)).toBe(before);
 expect(unzipSync(await save(p,d))).toEqual(unzipSync(source));
});
it('recomputes shared counters after restart edits, preserves unrelated parts, reopens and exactly undoes',async()=>{
 const p=await DocxPackage.open(source),d=model(p),original=labels(d);d.select(d.text.indexOf('Alpha'));d.restartNumbering(10);
 expect(labels(d).slice(0,5)).toEqual(['10.','11.','1.','2.','3.']);
 const bytes=await save(p,d),parts=unzipSync(bytes),again=model(await DocxPackage.open(bytes));expect(labels(again)).toEqual(labels(d));
 for(const name of Object.keys(p.parts))if(!['word/document.xml','word/numbering.xml'].includes(name))expect(parts[name]).toEqual(p.parts[name]);
 d.undo();expect(labels(d)).toEqual(original);expect(unzipSync(await save(p,d))).toEqual(unzipSync(source));
});
