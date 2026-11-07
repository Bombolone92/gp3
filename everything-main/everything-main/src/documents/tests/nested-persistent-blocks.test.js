import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync,zipSync,strFromU8,strToU8} from 'fflate';
import {DocxPackage,W} from '../src/engine/docx.js';
import {TextDocument} from '../src/engine/model.js';
import {blockControlGroups} from '../src/engine/block-controls.js';
let dom;beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
const dir='tests/fixtures/nested-persistent-blocks/',source=readFileSync(dir+'control.docx');
const reference=JSON.parse(readFileSync(dir+'reference.json','utf8').replace(/^\uFEFF/,''));
const model=p=>new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
const save=async(p,d)=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
const name=c=>new DOMParser().parseFromString(c.shell,'application/xml').getElementsByTagNameNS(W,'alias')[0].getAttributeNS(W,'val');
const range=(d,title)=>blockControlGroups(d.paragraphs).find(g=>name(g.control)===title);
it('binds native nested edit evidence to its original source',()=>{
 const hash=b=>createHash('sha256').update(b).digest('hex');expect(hash(source)).toBe(reference.sourceSha256);expect(hash(readFileSync(dir+'native-edited.xml'))).toBe(reference.xmlSha256);
});
for(const ref of reference.cases)it('matches native nested wrappers after '+ref.name,async()=>{
 const p=await DocxPackage.open(source),d=model(p);expect(unzipSync(await save(p,d))).toEqual(unzipSync(source));
 const r=range(d,ref.name+(['replace-outer','delete-outer'].includes(ref.name)?' outer':' inner'));
 if(ref.name==='insert'){d.select(r.start+2);d.replace('NEW ');}
 else if(ref.name==='split'){d.select(r.start+5);d.replace('\n');}
 else {d.select(r.start,r.end);d.replace(ref.name.startsWith('delete-')?'':'Edited value');}
 const bytes=await save(p,d),reopened=model(await DocxPackage.open(bytes));expect(reopened.text).toBe(d.text);
 for(const current of [d,reopened])for(const expected of ref.controls){
  const g=range(current,ref.name+' '+expected.part);
  if(!expected.count){expect(g).toBeUndefined();continue;}
  expect(g).toBeDefined();expect(current.text.slice(g.start,g.end)).toBe(expected.text.replaceAll('\r','\n'));expect(g.control.placeholder).toBe(expected.placeholder);
 }
 for(const[n,b]of Object.entries(unzipSync(source)))if(n!=='word/document.xml')expect(unzipSync(bytes)[n]).toEqual(b);
 d.undo();expect(unzipSync(await save(p,d))).toEqual(unzipSync(source));d.redo();expect(d.text).toBe(reopened.text);
});
it('preserves nested ownership through search replacement and guards partial joins atomically',async()=>{
 const p=await DocxPackage.open(source),d=model(p);const r=range(d,'insert inner');d.select(r.start-1,r.start+2);const before=d.snapshot();expect(()=>d.replace('X')).toThrow('boundary');expect(d.snapshot()).toEqual(before);
 expect(d.replaceMatches('Alpha beta','Changed',{},true)).toBe(7);const reopened=model(await DocxPackage.open(await save(p,d)));expect(reopened.text).toBe(d.text);expect(blockControlGroups(reopened.paragraphs)).toHaveLength(13);
 d.undo();expect(unzipSync(await save(p,d))).toEqual(unzipSync(source));
});
it('still guards tables beneath a temporary child of a persistent block',async()=>{
 const parts=unzipSync(source),xml=new DOMParser().parseFromString(strFromU8(parts['word/document.xml']),'application/xml');
 const properties=xml.getElementsByTagNameNS(W,'sdtPr')[1];properties.insertBefore(xml.createElementNS(W,'w:temporary'),properties.lastElementChild);
 const content=xml.getElementsByTagNameNS(W,'sdtContent')[1];content.replaceChildren(xml.createElementNS(W,'w:tbl'));parts['word/document.xml']=strToU8(new XMLSerializer().serializeToString(xml));
 await expect(DocxPackage.open(zipSync(parts))).rejects.toThrow('persistent controls around tables');
});
