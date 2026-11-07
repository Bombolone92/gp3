import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync,zipSync,strFromU8,strToU8} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument} from '../src/engine/model.js';
import {noteMarkRanges} from '../src/engine/note-marks.js';
const root='tests/fixtures/inactive-note-marks/';
const reference=JSON.parse(readFileSync(root+'reference.json','utf8'));
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
const model=p=>new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
const save=async(p,d)=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
it.each([['control','1'],['numbering-upperRoman','I'],['numbering-decimalZero','01']])('renders native ordinal one for both mark kinds in %s',async(name,label)=>{
 const p=await DocxPackage.open(readFileSync(root+name+'.docx')),d=model(p);
 expect(p.readOnly).not.toBe(true);expect(noteMarkRanges(d.paragraphs)).toHaveLength(8);
 expect(d.text).toContain('footnoteRef: A'+label+'B');expect(d.text).toContain('endnoteRef: A'+label+'B');expect(d.text).toContain('Table: A'+label+label+'B');
 const native=reference.cases.find(c=>c.name===name);
 expect(createHash('sha256').update(readFileSync(root+name+'.docx')).digest('hex')).toBe(native.sourceSha256);
 expect(createHash('sha256').update(readFileSync(root+(name==='control'?'native':name+'-native')+'.pdf')).digest('hex')).toBe(native.pdfSha256);
 expect(d.text.replace(/\s/g,'')).toBe(native.text.replace(/\s/g,''));
 expect(unzipSync(await save(p,d))).toEqual(p.parts);
 d.select(d.text.indexOf('A'+label+'B'));d.replace('Before');
 const output=await save(p,d),again=model(await DocxPackage.open(output));expect(again.text).toBe(d.text);expect(noteMarkRanges(again.paragraphs)).toHaveLength(8);
 for(const[name,bytes]of Object.entries(p.parts))if(name!=='word/document.xml')expect(unzipSync(output)[name]).toEqual(bytes);
 d.undo();expect(unzipSync(await save(p,d))).toEqual(p.parts);
});
it('preserves mark formatting and element identity, including adjacent marks',async()=>{
 const p=await DocxPackage.open(readFileSync(root+'control.docx')),d=model(p),r=noteMarkRanges(d.paragraphs)[0];
 d.select(r.start,r.end);d.toggleBold();
 let again=model(await DocxPackage.open(await save(p,d)));expect(noteMarkRanges(again.paragraphs)).toHaveLength(8);
 expect(again.paragraphs.flatMap(p=>p.runs).find(r=>r.noteMark).bold).toBe(true);
 const adjacent=d.text.indexOf('\n11\n')+1;d.select(adjacent,adjacent+2);d.toggleItalic();
 again=model(await DocxPackage.open(await save(p,d)));expect(noteMarkRanges(again.paragraphs)).toHaveLength(8);
 d.undo();d.undo();expect(unzipSync(await save(p,d))).toEqual(p.parts);
});
it('replaces a multi-character mark as one object and does not propagate it to typed text',async()=>{
 const p=await DocxPackage.open(readFileSync(root+'numbering-decimalZero.docx')),d=model(p),r=noteMarkRanges(d.paragraphs)[0];
 d.select(r.start+1);expect(d.range).toEqual([r.start,r.end]);d.replace('Note');expect(noteMarkRanges(d.paragraphs)).toHaveLength(7);
 expect(model(await DocxPackage.open(await save(p,d))).text).toBe(d.text);d.undo();expect(unzipSync(await save(p,d))).toEqual(p.parts);
 d.select(r.end);d.replace('After');expect(noteMarkRanges(d.paragraphs)).toHaveLength(8);expect(model(await DocxPackage.open(await save(p,d))).text).toBe(d.text);
 d.undo();d.select(r.end);d.delete(-1);expect(noteMarkRanges(d.paragraphs)).toHaveLength(7);d.undo();expect(unzipSync(await save(p,d))).toEqual(p.parts);
});
it('find replacement removes complete marks and retains ordinary replacement characters',async()=>{
 const p=await DocxPackage.open(readFileSync(root+'numbering-decimalZero.docx')),d=model(p);
 expect(d.replaceMatches('1','X',{},true)).toBe(8);expect(noteMarkRanges(d.paragraphs)).toHaveLength(0);
 expect(model(await DocxPackage.open(await save(p,d))).text).toBe(d.text);d.undo();expect(unzipSync(await save(p,d))).toEqual(p.parts);
});
it.each(['<w:footnoteRef w:id="1"/>','<w:footnoteRef><w:t>bad</w:t></w:footnoteRef>','<w:footnoteReference w:id="1"/>','<w:endnoteReference w:id="1"/>'])('keeps malformed marks and actual note references guarded: %s',async markup=>{
 const parts=unzipSync(readFileSync(root+'control.docx'));parts['word/document.xml']=strToU8(strFromU8(parts['word/document.xml']).replace('<w:footnoteRef/>',markup));
 await expect(DocxPackage.open(zipSync(parts))).rejects.toThrow();
});
