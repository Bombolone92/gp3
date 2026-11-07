import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
const source=readFileSync('public/fixtures/connectors.docx'),A='http://schemas.openxmlformats.org/drawingml/2006/main',S='http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
it('retains connector locks, endpoints and source geometry through atomic deletion, edit/reopen and undo',async()=>{
 const p=await DocxPackage.open(source),d=new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
 expect(Object.values(p.assets)).toHaveLength(8);
 const save=async()=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
 d.select(0);d.replace('Edited ');const at=d.text.indexOf('\ufffc');d.select(at,at+1);expect(()=>d.setImageProperties({width:100})).toThrow(/complete objects/);d.replace('');d.undo();
 const reopened=await DocxPackage.open(await save());expect(Object.values(reopened.assets).map(a=>a.scene)).toEqual(Object.values(p.assets).map(a=>a.scene));
 const xml=new DOMParser().parseFromString(strFromU8(reopened.parts['word/document.xml']),'application/xml');
 expect(xml.getElementsByTagNameNS(S,'cNvCnPr')).toHaveLength(8);expect(xml.getElementsByTagNameNS(A,'stCxn')[0].getAttribute('id')).toBe('1001');expect(xml.getElementsByTagNameNS(A,'endCxn')[0].getAttribute('idx')).toBe('1');
 while(d.history.length)d.undo();const out=unzipSync(await save());for(const [name,data] of Object.entries(p.parts))expect(Buffer.from(out[name]).equals(Buffer.from(data)),name).toBe(true);
});
async function modified(change){const parts=unzipSync(source),xml=new DOMParser().parseFromString(strFromU8(parts['word/document.xml']),'application/xml'),p=xml.getElementsByTagNameNS(S,'cNvCnPr')[1];change(p,xml);parts['word/document.xml']=strToU8(new XMLSerializer().serializeToString(xml));return zipSync(parts);}
it.each([
 ['conflicting shape properties',(p,x)=>p.before(x.createElementNS(S,'wps:cNvSpPr'))],
 ['property attribute',p=>p.setAttribute('unknown','1')],
 ['property text',p=>p.append('text')],
 ['duplicate locks',p=>p.append(p.firstElementChild.cloneNode(true))],
 ['unknown property child',(p,x)=>p.append(x.createElementNS(A,'a:unknown'))],
 ['foreign child',(p,x)=>p.append(x.createElementNS('urn:future','f:stCxn'))],
 ['unknown lock',p=>p.firstElementChild.setAttribute('future','1')],
 ['invalid boolean',p=>p.firstElementChild.setAttribute('noMove','yes')],
 ['shape-only lock',p=>p.firstElementChild.setAttribute('noTextEdit','1')],
 ['selection lock',p=>p.firstElementChild.setAttribute('noSelect','true')],
 ['lock extension',(p,x)=>p.firstElementChild.append(x.createElementNS(A,'a:extLst'))],
 ['missing endpoint id',p=>p.children[1].removeAttribute('id')],
 ['missing endpoint index',p=>p.children[1].removeAttribute('idx')],
 ['negative index',p=>p.children[1].setAttribute('idx','-1')],
 ['overflow id',p=>p.children[1].setAttribute('id','4294967296')],
 ['fractional index',p=>p.children[1].setAttribute('idx','1.5')],
 ['unknown endpoint attribute',p=>p.children[1].setAttribute('other','1')],
 ['endpoint text',p=>p.children[1].append('text')],
 ['endpoint child',(p,x)=>p.children[1].append(x.createElementNS(A,'a:pt'))],
 ['misordered endpoints',p=>p.insertBefore(p.lastElementChild,p.children[1])],
])('rejects %s before editable import',async(_name,change)=>{
 await expect(DocxPackage.open(await modified(change))).rejects.toMatchObject({name:'UnsupportedDocumentError'});
});
it.each(['0','-0','+0','4294967295','  +001  '])('retains unsigned endpoint lexical form %s',async value=>{
 const bytes=await modified(p=>{p.children[1].setAttribute('idx',value);}),p=await DocxPackage.open(bytes);
 const out=new Uint8Array(await p.export(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets).arrayBuffer());
 expect(unzipSync(out)['word/document.xml']).toEqual(unzipSync(bytes)['word/document.xml']);
});
