import {beforeAll, afterAll, it, expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument} from '../src/engine/model.js';
import {listMarkers} from '../src/engine/numbering.js';

let dom;
beforeAll(()=>{dom=new JSDOM('');globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
const folder='tests/fixtures/numbering-style-bindings/';
const cases=JSON.parse(readFileSync(folder+'cases.json'));
const native=JSON.parse(readFileSync(folder+'native.json','utf8').replace(/^\uFEFF/,''));
it('binds the native evidence to the independently authored source',()=>{
 const reference=JSON.parse(readFileSync(folder+'reference.json'));
 for(const [name,hash]of Object.entries(reference.hashes))expect(createHash('sha256').update(readFileSync(folder+name)).digest('hex')).toBe(hash);
 expect(reference.positions.map(p=>p.index)).toEqual(cases.map(c=>c.index));
 expect(native.sourceSha256).toBe(reference.hashes['control.docx']);
});
it('matches native style bindings, explicit levels and direct numbering for all independent controls',async()=>{
 const pkg=await DocxPackage.open(readFileSync(folder+'control.docx'));
 const doc=new TextDocument(pkg.paragraphs,pkg.pageSettings,pkg.numbering,pkg.styles);
 const markers=listMarkers(doc.paragraphs,doc.numbering);
 for(const c of cases)expect(markers[c.index]?.text??'',c.name).toBe(native.cases[c.index].marker);
});
it('recomputes list ownership when changing styles and preserves declarations through export and undo',async()=>{
 const pkg=await DocxPackage.open(readFileSync(folder+'control.docx'));
 const doc=new TextDocument(pkg.paragraphs,pkg.pageSettings,pkg.numbering,pkg.styles);
 doc.select(doc.text.indexOf('N24 '));
 expect(doc.paragraphs[24].list).toBeNull();
 doc.setParagraphStyle('Unrelated24_0');
 expect(listMarkers(doc.paragraphs,doc.numbering)[24]?.text).toBe('L0');
 const save=async()=>new Uint8Array(await pkg.export(doc.paragraphs,doc.pageSettings,doc.numbering,doc.styles).arrayBuffer());
 const edited=await save(), reopened=await DocxPackage.open(edited);
 expect(listMarkers(reopened.paragraphs,reopened.numbering)[24]?.text).toBe('L0');
 const parts=unzipSync(edited);
 for(const [name,bytes]of Object.entries(pkg.parts))if(name!=='word/document.xml')expect(parts[name]).toEqual(bytes);
 doc.undo();expect(doc.paragraphs[24].list).toBeNull();expect(unzipSync(await save())).toEqual(pkg.parts);
});
it.each(['format', 'clear', 'split'])('exports edits while retaining inactive inherited list geometry: %s', async action => {
 const pkg = await DocxPackage.open(readFileSync(folder + 'control.docx'));
 const doc = new TextDocument(pkg.paragraphs, pkg.pageSettings, pkg.numbering, pkg.styles);
 doc.select(doc.paragraphOffset(24) + 4);
 expect(doc.paragraphs[24].list).toBeNull(); expect(doc.paragraphs[24].listContext.inactiveList).toBeTruthy();
 if (action === 'split') doc.insertParagraph();
 else { doc.setParagraphFormat({ alignment: 'right', indentLeft: 840 }); if (action === 'clear') doc.clearDirectParagraphFormatting(); }
 const saved = new Uint8Array(await pkg.export(doc.paragraphs, doc.pageSettings, doc.numbering, doc.styles).arrayBuffer());
 const reopened = await DocxPackage.open(saved);
 expect(reopened.paragraphs.map(p => p.runs.map(r => r.text).join(''))).toEqual(doc.paragraphs.map(p => p.runs.map(r => r.text).join('')));
 expect(listMarkers(reopened.paragraphs, reopened.numbering)).toEqual(listMarkers(doc.paragraphs, doc.numbering));
 const out = new TextDocument(reopened.paragraphs, reopened.pageSettings, reopened.numbering, reopened.styles);
 out.select(out.paragraphOffset(24)); doc.select(doc.paragraphOffset(24));
 expect(out.paragraphFormatting).toEqual(doc.paragraphFormatting);
 expect(reopened.paragraphs[24].list).toBeNull(); expect(reopened.paragraphs[24].listContext.inactiveList).toEqual(doc.paragraphs[24].listContext.inactiveList);
 const parts = unzipSync(saved); for (const [name, bytes] of Object.entries(pkg.parts)) if (name !== 'word/document.xml') expect(parts[name]).toEqual(bytes);
});
