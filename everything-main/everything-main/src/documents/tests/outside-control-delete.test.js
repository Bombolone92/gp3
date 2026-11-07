import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument} from '../src/engine/model.js';
import {contentControlRanges} from '../src/engine/content-controls.js';
const root='tests/fixtures/outside-control-delete/',ref=JSON.parse(readFileSync(root+'reference.json'));
const model=p=>new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
const save=async(p,d)=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
let dom;beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});afterAll(()=>dom.window.close());
for(const c of ref.cases.filter(c=>c.key!=='type'))it(`${c.key} selects, then clears the control as the native reference does`,async()=>{
 for(const[f,h]of [[ref.source,ref.sourceSha256],[c.result,c.sha256]])expect(createHash('sha256').update(readFileSync(root+f)).digest('hex')).toBe(h);
 const p=await DocxPackage.open(readFileSync(root+ref.source)),d=model(p),r=contentControlRanges(d.paragraphs)[0];
 const direction=c.key==='Delete'?1:-1,at=direction>0?r.start:r.end;
 d.select(at,at,{id:r.control.id,side:direction>0?'before':'after'});
 const revision=d.revision;
 expect(d.delete(direction)).toBe(false);expect(d.text).toBe('ABCD');expect(d.range).toEqual([1,3]);
 expect(d.history).toHaveLength(0);expect(d.revision).toBe(revision);expect(unzipSync(await save(p,d))).toEqual(p.parts);
 expect(d.delete(direction)).toBe(true);expect(d.text).toBe(c.text);
 const empty=contentControlRanges(d.paragraphs)[0];expect(empty.end-empty.start).toBe(0);expect(empty.control.placeholder).toBe(false);
 expect(d.selection.controlCaret).toEqual({id:r.control.id,side:'inside'});expect(d.history).toHaveLength(1);
 const bytes=await save(p,d),parts=unzipSync(bytes),again=model(await DocxPackage.open(bytes));expect(again.text).toBe(c.text);expect(contentControlRanges(again.paragraphs)).toHaveLength(1);
 for(const[n,b]of Object.entries(p.parts))if(n!=='word/document.xml')expect(parts[n]).toEqual(b);
 d.undo();expect(d.range).toEqual([1,3]);expect(unzipSync(await save(p,d))).toEqual(p.parts);d.redo();expect(d.text).toBe(c.text);
 d.leaveEmptyControl('after');expect(d.text).toBe('A     D');d.undo();expect(d.text).toBe('AD');
 expect(d.delete(direction)).toBe(true);expect(d.text).toBe('AD');expect(contentControlRanges(d.paragraphs)).toHaveLength(0);
});
it('typing replaces the selected contents inside the control',async()=>{
 const c=ref.cases.find(c=>c.key==='type');expect(createHash('sha256').update(readFileSync(root+c.result)).digest('hex')).toBe(c.sha256);
 const p=await DocxPackage.open(readFileSync(root+ref.source)),d=model(p),r=contentControlRanges(d.paragraphs)[0];
 d.select(3,3,{id:r.control.id,side:'after'});d.delete(-1);d.replace('X');
 expect(d.text).toBe(c.text);const owned=contentControlRanges(d.paragraphs)[0];expect(d.text.slice(owned.start,owned.end)).toBe(c.controlText);
 d.undo();expect(unzipSync(await save(p,d))).toEqual(p.parts);
});
it('selection changes cancel the boundary selection without creating history',async()=>{
 const d=model(await DocxPackage.open(readFileSync(root+ref.source))),r=contentControlRanges(d.paragraphs)[0];
 d.select(1,1,{id:r.control.id,side:'before'});d.delete(1);d.select(0);d.delete(1);
 expect(d.text).toBe('BCD');expect(d.history).toHaveLength(1);d.undo();expect(d.text).toBe('ABCD');
});
it('ordinary full text selection clears to the independently saved empty reference control',async()=>{
 const c=ref.ordinarySelection;expect(createHash('sha256').update(readFileSync(root+c.result)).digest('hex')).toBe(c.sha256);
 const p=await DocxPackage.open(readFileSync(root+ref.source)),d=model(p);
 d.select(1,3);expect(d.delete(1)).toBe(true);expect(d.text).toBe(c.text);
 const r=contentControlRanges(d.paragraphs)[0];expect(r.end-r.start).toBe(0);expect(r.control.placeholder).toBe(false);
 const native=model(await DocxPackage.open(readFileSync(root+c.result)));expect(native.text).toBe(d.text);
 expect(contentControlRanges(native.paragraphs)[0].control.placeholder).toBe(false);
 d.undo();expect(unzipSync(await save(p,d))).toEqual(p.parts);
});
it('the internal empty-control option rejects nonempty replacement and partial selection atomically',async()=>{
 const d=model(await DocxPackage.open(readFileSync(root+ref.source)));
 d.select(1,2);const before=d.snapshot();expect(()=>d.replace('',{emptyInlineControl:true})).toThrow();expect(d.snapshot()).toEqual(before);
 d.select(1,3);const selected=d.snapshot();expect(()=>d.replace('X',{emptyInlineControl:true})).toThrow();expect(d.snapshot()).toEqual(selected);
});
