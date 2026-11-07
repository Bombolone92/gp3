import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument} from '../src/engine/model.js';
import {contentControlRanges} from '../src/engine/content-controls.js';
const root='tests/fixtures/filled-control-delete/',ref=JSON.parse(readFileSync(root+'reference.json'));
const model=p=>new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
const save=async(p,d)=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
let dom;beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});afterAll(()=>dom.window.close());
for(const c of ref.cases)it(`${c.key} at the inside filled boundary preserves text, ownership and history`,async()=>{
 for(const[f,h]of [[ref.source,ref.sourceSha256],[c.result,c.sha256]])expect(createHash('sha256').update(readFileSync(root+f)).digest('hex')).toBe(h);
 const p=await DocxPackage.open(readFileSync(root+ref.source)),d=model(p),r=contentControlRanges(d.paragraphs)[0];
 d.select(c.offset,c.offset,{id:r.control.id,side:'inside'});const before=d.snapshot();
 for(let i=0;i<3;i++)expect(d.delete(c.key==='Backspace'?-1:1)).toBe(false);
 expect(d.snapshot()).toEqual(before);expect(d.history).toHaveLength(0);expect(unzipSync(await save(p,d))).toEqual(p.parts);
 d.replace('X');expect(d.text).toBe(c.text);const owned=contentControlRanges(d.paragraphs)[0];expect(d.text.slice(owned.start,owned.end)).toBe(c.controlText);
 const bytes=await save(p,d),parts=unzipSync(bytes),again=model(await DocxPackage.open(bytes));expect(again.text).toBe(c.text);
 for(const[n,b]of Object.entries(p.parts))if(n!=='word/document.xml')expect(parts[n]).toEqual(b);
 d.undo();expect(unzipSync(await save(p,d))).toEqual(p.parts);d.redo();expect(d.text).toBe(c.text);
});
for(const [offset,direction,text]of [[1,1,'ACD'],[3,-1,'ABD'],[2,-1,'ACD'],[2,1,'ABD']])it(`ordinary inside deletion ${offset}/${direction} still consumes text`,async()=>{
 const d=model(await DocxPackage.open(readFileSync(root+ref.source))),r=contentControlRanges(d.paragraphs)[0];d.select(offset,offset,{id:r.control.id,side:'inside'});
 expect(d.delete(direction)).toBe(true);expect(d.text).toBe(text);expect(contentControlRanges(d.paragraphs)).toHaveLength(1);
});
for(const [side,offset,direction,text]of [['before',1,-1,'BCD'],['after',3,1,'ABC']])it(`outside ${side} caret still deletes ordinary neighboring text`,async()=>{
 const d=model(await DocxPackage.open(readFileSync(root+ref.source))),r=contentControlRanges(d.paragraphs)[0];
 d.select(offset,offset,{id:r.control.id,side});expect(d.delete(direction)).toBe(true);expect(d.text).toBe(text);
 const remaining=contentControlRanges(d.paragraphs)[0];expect(d.text.slice(remaining.start,remaining.end)).toBe('BC');
});
