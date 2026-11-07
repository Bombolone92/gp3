import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
import { layoutDocument } from '../src/engine/layout.js';
import { pageGeometry } from '../src/engine/page-settings.js';
let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
const source = readFileSync('public/fixtures/legacy-numbering.docx');
const model = p => new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
const layout = d => layoutDocument(d.paragraphs, text => ({width:text.length*6,ascent:12,descent:3}),pageGeometry(d.pageSettings),d.numbering,d.tables);
const save = async(p,d)=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
function mutate(fn) { const parts=unzipSync(source);parts['word/numbering.xml']=strToU8(fn(strFromU8(parts['word/numbering.xml'])));return zipSync(parts); }
it('reproduces legacy label areas, explicit/default flags, suffix independence and negative label suppression',async()=>{
 const doc=model(await DocxPackage.open(source)), lines=layout(doc).lines;
 const at=name=>lines.find(l=>l.fragments.map(f=>f.text).join('').startsWith(name+' sample'));
 expect(at('On').marker.x).toBe(120); expect(at('On').stops[0].x).toBe(184);
 for(const name of ['Tab','Space']) expect(at(name).stops[0].x).toBe(184);
 for(const name of ['Modern','Off','Implicit']) expect(at(name).stops[0].x).toBe(132);
 expect(at('Right').marker.x).toBe(156); expect(at('Center').marker.x).toBe(146);
 expect(at('LargeSpace').stops[0].x).toBe(212);
 for(const name of ['Negative','NegativeRight']) {expect(at(name).marker).toBeFalsy();expect(at(name).stops[0].x).toBe(96);}
 expect(at('Missing').stops[0].x).toBe(144);expect(at('NoGeometry').stops[0].x).toBe(108);
});
it('preserves legacy XML through text edits, numbering restart, reopen and exact undo',async()=>{
 const pkg=await DocxPackage.open(source), doc=model(pkg);
 expect(unzipSync(await save(pkg,doc))).toEqual(pkg.parts);
 doc.select(doc.text.indexOf('On sample'));doc.replace('Edited ');doc.restartNumbering(12);
 const bytes=await save(pkg,doc), reopened=model(await DocxPackage.open(bytes));
 expect(reopened.text).toBe(doc.text);expect(layout(reopened).lines.find(l=>l.marker?.text==='12.').stops[0].x).toBe(184);
 const parts=unzipSync(bytes);
 for(const[name,data]of Object.entries(pkg.parts))if(!['word/document.xml','word/numbering.xml'].includes(name))expect(parts[name]).toEqual(data);
 expect(strFromU8(parts['word/numbering.xml'])).toContain('legacyIndent="960"');
 while(doc.history.length)doc.undo();expect(unzipSync(await save(pkg,doc))).toEqual(pkg.parts);
});
it('uses ordinary paragraph indentation for continuation lines',async()=>{
 const doc=model(await DocxPackage.open(source));doc.select(doc.text.indexOf('On sample'));doc.replace('First\v');
 const lines=layout(doc).lines;const first=lines.findIndex(l=>l.fragments.map(f=>f.text).join('')==='First');
 expect(lines[first].stops[0].x).toBe(184);expect(lines[first+1].stops[0].x).toBe(144);expect(lines[first+1].marker).toBeFalsy();
});
it.each(['w:legacy="maybe"','w:legacy="1" w:legacySpace="-1"','w:legacy="1" w:legacyIndent="NaN"','w:legacy="1" w:legacyIndent="31681"','w:legacy="1" w:unknown="1"'])('rejects malformed properties %s',async attributes=>{
 await expect(DocxPackage.open(mutate(s=>s.replace('<w:legacy w:legacy="on" w:legacyIndent="960" w:legacySpace="240"/>',`<w:legacy ${attributes}/>`)))).rejects.toThrow(/legacy numbering/i);
});
it('reads universal-measure legacy distances',async()=>{
 const doc=model(await DocxPackage.open(mutate(s=>s.replaceAll('w:legacyIndent="960"','w:legacyIndent="48pt"').replaceAll('w:legacySpace="240"','w:legacySpace="12pt"'))));
 expect(layout(doc).lines[2].stops[0].x).toBe(184);
});
