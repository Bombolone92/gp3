import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument} from '../src/engine/model.js';
import {contentControlRanges} from '../src/engine/content-controls.js';
const root='tests/fixtures/empty-control-delete/',ref=JSON.parse(readFileSync(root+'reference.json'));
const model=p=>new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
const save=async(p,d)=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
let dom;beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});afterAll(()=>dom.window.close());
for(const c of ref.cases)it(`${c.key} removes the native empty wrapper without deleting adjacent text`,async()=>{
 for(const [f,h]of [[ref.source,ref.sourceSha256],[c.file,c.sha256]])expect(createHash('sha256').update(readFileSync(root+f)).digest('hex')).toBe(h);
 const p=await DocxPackage.open(readFileSync(root+ref.source)),d=model(p),range=contentControlRanges(d.paragraphs)[0];
 d.select(range.start,range.start,{id:range.control.id,side:'inside'});
 expect(d.delete(c.key==='Backspace'?-1:1)).toBe(true);expect(d.text).toBe(c.text);expect(contentControlRanges(d.paragraphs)).toHaveLength(c.controls);
 expect(d.selection).toEqual({anchor:1,focus:1});expect(d.history).toHaveLength(1);
 const bytes=await save(p,d),parts=unzipSync(bytes),again=model(await DocxPackage.open(bytes));
 expect(again.text).toBe(c.text);expect(contentControlRanges(again.paragraphs)).toHaveLength(0);
 for(const[n,b]of Object.entries(p.parts))if(n!=='word/document.xml')expect(parts[n]).toEqual(b);
 d.undo();expect(unzipSync(await save(p,d))).toEqual(p.parts);expect(d.selection.controlCaret?.side).toBe('inside');
 d.redo();expect(d.text).toBe(c.text);expect(contentControlRanges(d.paragraphs)).toHaveLength(0);
});
for(const direction of [-1,1])it(`deletes only the owned empty wrapper at all six fixture boundaries (${direction})`,async()=>{
 const bytes=readFileSync('tests/fixtures/empty-inline-controls/control.docx');
 const base=await DocxPackage.open(bytes),ids=contentControlRanges(base.paragraphs).map(r=>r.control.id);
 expect(ids).toHaveLength(6);
 for(const id of ids){
  const p=await DocxPackage.open(bytes),d=model(p),text=d.text,r=contentControlRanges(d.paragraphs).find(r=>r.control.id===id);
  d.select(r.start,r.start,{id,side:'inside'});expect(d.delete(direction)).toBe(true);
  expect(d.text).toBe(text);expect(contentControlRanges(d.paragraphs).map(r=>r.control.id)).toEqual(ids.filter(i=>i!==id));
  const reopened=model(await DocxPackage.open(await save(p,d)));expect(reopened.text).toBe(text);expect(contentControlRanges(reopened.paragraphs)).toHaveLength(5);
  d.undo();expect(unzipSync(await save(p,d))).toEqual(p.parts);
 }
});
it('keeps bookmarks when removing their empty enclosing wrapper',async()=>{
 const p=await DocxPackage.open(readFileSync(root+ref.source)),d=model(p),r=contentControlRanges(d.paragraphs)[0];
 r.paragraph.bookmarks=[{id:'kept',name:'kept',edge:'start',offset:1,contentControlId:r.control.id},{id:'kept',edge:'end',offset:1,contentControlId:r.control.id}];
 d.select(1,1,{id:r.control.id,side:'inside'});d.delete(-1);
 expect(r.paragraph.bookmarks.map(m=>m.offset)).toEqual([1,1]);expect(r.paragraph.bookmarks.every(m=>!m.contentControlId)).toBe(true);
});
